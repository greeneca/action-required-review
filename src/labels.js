const core = require( '@actions/core' );
const github = require( '@actions/github' );
const { WError } = require( 'error' );

/**
* Fetch the paths in the current PR.
*
* @return {string[]} Paths.
*/
async function fetchLabels() {
    const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
    const owner = github.context.payload.repository.owner.login;
    const repo = github.context.payload.repository.name;
    const pr = github.context.payload.pull_request.number;

    try {
        const pull = await octokit.rest.pulls.get({
            owner: owner,
            repo: repo,
            pull_number: pr,
        });
        return data.labels.map((label) => label.name);
    } catch ( error ) {
        throw new WError(
            `Failed to query ${ owner }/${ repo } PR #${ pr } files from GitHub`,
            error,
            {}
        );
    }
}

module.exports = fetchLabels;
