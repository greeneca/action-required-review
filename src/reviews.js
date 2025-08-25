const core = require( '@actions/core' );
const github = require( '@actions/github' );
const { WError } = require( 'error' );

/**
 * Fetch the reviews in the current PR.
 *
 * @return {string[]} Paths.
 */
async function fetchReviews() {
	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const owner = github.context.payload.repository.owner.login;
	const repo = github.context.payload.repository.name;
	const pr = github.context.payload.pull_request.number;

	const reviewers = {};
	try {
		res = await octokit.rest.pulls.listReviews({
			owner: owner,
			repo: repo,
			pull_number: pr,
		});
        res.data.forEach( review => {
            reviewers[ review.login ] = true;
        } );
	} catch ( error ) {
		throw new WError(
			`Failed to query ${ owner }/${ repo } PR #${ pr } reviews from GitHub`,
			error,
			{}
		);
	}

	return Object.keys( reviewers ).sort();
}

module.exports = fetchReviews;
