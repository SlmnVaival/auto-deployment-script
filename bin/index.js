#!/usr/bin/env node
const axios = require("axios");
const {exec} = require('node:child_process');
const util = require("util");
const execProm = util.promisify(exec);
const readLine = require('readline');
const fs = require("fs")

let githubToken;
let githubCloneURL;
let githubRepoVisibility;
let progressBarActivity;
let githubUserName;
let gitCurrentRepoName;
let repoAbsPathVar;

const readline = readLine.createInterface({
    input: process.stdin, output: process.stdout,
});


async function run_shell_command(command) {
    let result;
    try {
        result = await execProm(command);
    } catch (ex) {
        onErrorBreak(ex);
    }
    if (Error[Symbol.hasInstance](result)) return;

    return result;
}

onErrorBreak = (args, atPoint) => {
    console.error(args, atPoint);
    process.exit(0);
}
getRepoName = async (githUrl) => {
    let n = githUrl.lastIndexOf('/');
    let repo_name = githUrl.substring(n + 1).replace(".git", "");
    gitCurrentRepoName = repo_name.replaceAll('-', '_');
    return repo_name;
}
// show success message once every done.
showSuccessMsg = () => {
    readline.write("\n Huu! Docker Build pushed to server \n");
    process.exit(0);
}
askDockerPort = (container_name, image_url) => {
    let env_file_path = repoAbsPathVar + '/.env';
    if (fs.existsSync(env_file_path)) {
        readline.question("What is the Expose Port:Incoming Port ", port => {
            if (port) {
                writeDockerComposeFile(container_name, image_url, env_file_path, port);
            } else {
                askDockerPort(container_name, image_url);
            }
        })
    } else {
        onErrorBreak("No .env file exists");
    }
}
writeDockerComposeFile = async (container_name, image_url, env_file_path, port) => {
    let dockerFileContent = fs.readFileSync("./docker-sample.yml", {encoding: 'utf8', flag: 'r'});
    dockerFileContent = dockerFileContent.replaceAll("${container_name}", container_name);
    dockerFileContent = dockerFileContent.replace("${image_url}", image_url);
    dockerFileContent = dockerFileContent.replace("${env_file_path}", env_file_path);
    dockerFileContent = dockerFileContent.replace("${expose_port_incoming_port}", port);
    fs.writeFileSync("docker-compose.yml", dockerFileContent, err => {
        onErrorBreak(err, "Writing docker-compose.yml file");
    });
    upDockerContainer();
}
upDockerContainer = async () => {
    showProgressBar("Doing to Up Docker container.");
    run_shell_command(`docker-compose up -d`).then(res => {
        removeProgressBar();
        showSuccessMsg();
        deleteClonedRepo(repoAbsPathVar);
    })
}

// Get the GitHub record.
async function getGithubRepoDetails(gitHubURL) {
    return await axios.get(gitHubURL).then(async res => {
        githubCloneURL = res.data.clone_url;
        githubRepoVisibility = res.data.visibility;
        if (githubCloneURL) {
            await askCloneDirectory();
        } else {
            onErrorBreak("Github clone url is not found.");
        }
    }).catch(async err => {
        if (err.response && err.response.status === 404) {
            return await getGitHubRepoWithGitHubSecret(gitHubURL);
        } else {
            onErrorBreak("Invalid GitHub Url provided");
            return false;
        }
    })
}

// Get the GitHub record from secret, This will only calls when Github repository Private.
async function getGitHubRepoWithGitHubSecret(gitHubURL) {
    askGithubUserName(gitHubURL);
}

// ask for GitHub access token
askGithubAccessToken = async (gitHubURL) => {
    readline.question("What's your Github access Token? ", githubAccessToken => {
        return axios.get(gitHubURL, {
            headers: {
                'Authorization': `Bearer ${githubAccessToken}`
            }
        }).then((res) => res).then(res => {
            githubToken = githubAccessToken;
            githubCloneURL = res.data.clone_url;
            githubRepoVisibility = res.data.visibility;
            askCloneDirectory();
        }).catch(async err => {
            console.error(err.message, "Invalid GitHub Repo.");
            return false;
        })
    });
}

// ask for GitHub username.
askGithubUserName = async (gitHubURL) => {
    readline.question("What's your github username? ", async githubUsername_ => {
        if (githubUsername_) {
            githubUserName = githubUsername_;
            await askGithubAccessToken(gitHubURL);
        } else {
            readline.write("Please provide github username");
            await askGithubUserName(gitHubURL);
        }
    })
}

// Parse github url to API url
async function parseGitHubURL(gitHubRepoURl) {
    return gitHubRepoURl.replace("https://github.com/", "https://api.github.com/repos/");
}

// show progress bar.
showProgressBar = (message) => {
    readline.write('\n' + message + '\n');
    progressBarActivity = setInterval(() => {
        process.stdout.write("=");
    }, 100);
}

// remove progress bar.
removeProgressBar = () => {
    clearInterval(progressBarActivity);
}

// Build docker image.
buildDockerImage = async (repoAbsPath) => {
    repoAbsPathVar = repoAbsPath;
    if (fs.readFileSync(repoAbsPath + '/Dockerfile')) {
        // If docker file already exits in the folder
        readline.question("What's docker image name? ", async dockerImagePath => {
            if (dockerImagePath) {
                showProgressBar("Building docker image....");
                run_shell_command(`cd ${repoAbsPath} && docker build -t ${dockerImagePath}:latest .`).then(res => {
                    removeProgressBar();
                    pushDockerImage(dockerImagePath);
                })
            } else {
                onErrorBreak("Docker Image name wasn't provided.");
                await buildDockerImage(repoAbsPath);
            }
        });
    } else {
        readline.write("Dockerfile is not exits in repsoitory");
        await deleteClonedRepo(repoAbsPath);
    }
}

// delete clonned repo.
deleteClonedRepo = async (repoAbsPath) => {
    fs.rmSync(repoAbsPath, {recursive: true, force: true});
}


// Push docker image to hub.
pushDockerImage = async (dockerImagePath) => {
    showProgressBar("Pushing docker image...");
    await run_shell_command(`docker push ${dockerImagePath}:latest`).then(async res => {
        removeProgressBar();
        askDockerPort(gitCurrentRepoName, dockerImagePath);
    })
}

// Clone the repository
async function cloneCode(cloneDirectory) {

    let repoAbsPathrepoName = await getRepoName(githubCloneURL);
    let repoAbsPath = cloneDirectory + '/' + repoAbsPathrepoName;
    if (fs.existsSync(repoAbsPath)) {
        // repo already exits.
        await buildDockerImage(repoAbsPath);
    } else {
        // if file is not exists then clone and then go for the repo.
        if (githubRepoVisibility === 'public') {
            // clone the directory.
            showProgressBar("Start cloning....");
            await run_shell_command(`git clone ${githubCloneURL}`).then(async res => {
                removeProgressBar();
                await buildDockerImage(repoAbsPath);
            });
        } else {
            // Private repository.
            let cloneCommand = `git clone https://${githubUserName}:${githubToken}@`;
            githubCloneURL = githubCloneURL.replace("https://", cloneCommand);
            showProgressBar("Start cloning....");
            run_shell_command(githubCloneURL).then(async res => {
                removeProgressBar();
                await buildDockerImage(repoAbsPath);
            })
        }
    }
}

// Ask clone directory?
askCloneDirectory = async () => {
    readline.question("Where should it clone? (Press enter to clone in same directory)", async directoryPath => {
        if (!directoryPath) {
            let directoryPath = await defaultCloningDirectory();
            await cloneCode(directoryPath);
        } else {
            await cloneCode(directoryPath);
        }
    })
}
// default cloning direcotry
defaultCloningDirectory = async () => {
    return await run_shell_command("pwd").then(res => res.stdout.replace(/\n/g, ''));
}
// Main function to start Processor.
startProcess = async () => {
    // Ask GitHub url from console.
    readline.question(`What's the Github Repository URL? `, async githubURL => {
        let githubApiURL = await parseGitHubURL(githubURL);
        await getGithubRepoDetails(githubApiURL);
    });
}
startProcess();


