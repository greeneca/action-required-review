require('./sourcemap-register.js');/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 722:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 491 );
const github = __nccwpck_require__( 487 );
const { WError } = __nccwpck_require__( 564 );

/**
 * Fetch the paths in the current PR.
 *
 * @return {string[]} Paths.
 */
async function fetchPaths() {
	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const owner = github.context.payload.repository.owner.login;
	const repo = github.context.payload.repository.name;
	const pr = github.context.payload.pull_request.number;

	const paths = {};
	try {
		for await ( const res of octokit.paginate.iterator( octokit.rest.pulls.listFiles, {
			owner: owner,
			repo: repo,
			pull_number: pr,
			per_page: 100,
		} ) ) {
			res.data.forEach( file => {
				paths[ file.filename ] = true;
				if ( file.previous_filename ) {
					paths[ file.previous_filename ] = true;
				}
			} );
		}
	} catch ( error ) {
		throw new WError(
			`Failed to query ${ owner }/${ repo } PR #${ pr } files from GitHub`,
			error,
			{}
		);
	}

	return Object.keys( paths ).sort();
}

module.exports = fetchPaths;


/***/ }),

/***/ 877:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 491 );
const github = __nccwpck_require__( 487 );
const { WError } = __nccwpck_require__( 564 );

const STATE_ERROR = 'error';
const STATE_FAILURE = 'failure';
const STATE_PENDING = 'pending';
const STATE_SUCCESS = 'success';

/**
 * Report a status check to GitHub.
 *
 * @param {string} state       - One of the `STATE_*` constants.
 * @param {string} description - Description for the status.
 */
async function status( state, description ) {
	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const owner = github.context.payload.repository.owner.login;
	const repo = github.context.payload.repository.name;
	const req = {
		owner: owner,
		repo: repo,
		sha: github.context.payload.pull_request.head.sha,
		state: state,
		target_url: `${ github.context.serverUrl }/${ owner }/${ repo }/actions/runs/${ github.context.runId }`,
		description: description,
		context: core.getInput( 'status', { required: true } ),
	};

	if ( process.env.CI ) {
		await octokit.rest.repos.createCommitStatus( req );
	} else {
		// eslint-disable-next-line no-console
		console.dir( req );
	}
}

/**
 * Error class for friendly GitHub Action error reporting.
 *
 * Use it like
 * ```
 * throw ReportError.create( 'Status description', originalError );
 * ```
 */
class ReportError extends WError {}

module.exports = {
	STATE_ERROR: STATE_ERROR,
	STATE_FAILURE: STATE_FAILURE,
	STATE_PENDING: STATE_PENDING,
	STATE_SUCCESS: STATE_SUCCESS,
	status: status,
	ReportError: ReportError,
};
module.exports["default"] = module.exports;


/***/ }),

/***/ 620:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 491 );
const github = __nccwpck_require__( 487 );
const addVirtualTeams = __nccwpck_require__( 950 );

/**
 * Request review from the given team
 *
 * @param {string[]} teams - GitHub team slug, or @ followed by a GitHub user name.
 */
async function requestReviewer( teams ) {
	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const owner = github.context.payload.repository.owner.login;
	const repo = github.context.payload.repository.name;
	const pr = github.context.payload.pull_request.number;
	const author = `@${ github.context.payload.pull_request.user.login }`;
	if ( teams.includes( author ) ) {
		core.info( `Skipping review for author ${ author }` );
		teams = teams.filter( team => team !== author );
	}

	const userReviews = [];
	const teamReviews = [];

	for ( const t of teams ) {
		if ( t.startsWith( '@' ) && t.endsWith( '[bot]' ) ) {
			core.info( `Skipping ${ t }, appears to be a bot` );
		} else if ( t.startsWith( '@' ) ) {
			userReviews.push( t.slice( 1 ) );
		} else if ( t.startsWith( '+' ) ) {
            await addVirtualTeams( userReviews, t );
		} else {
			teamReviews.push( t );
		}
	}

	try {
		await octokit.rest.pulls.requestReviewers( {
			owner: owner,
			repo: repo,
			pull_number: pr,
			reviewers: userReviews,
			team_reviewers: teamReviews,
		} );
		core.info( `Requested review(s) from ${ teams }` );
	} catch ( err ) {
		throw new Error( `Unable to request review.\n  Error: ${ err }` );
	}
}

module.exports = requestReviewer;


/***/ }),

/***/ 101:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const assert = __nccwpck_require__( 613 );
const core = __nccwpck_require__( 491 );
const github = __nccwpck_require__( 487 );
const { SError } = __nccwpck_require__( 564 );
const picomatch = __nccwpck_require__( 792 );
const fetchTeamMembers = __nccwpck_require__( 971 );

class RequirementError extends SError {}

/**
 * Prints a result set, then returns it.
 *
 * @param {string}   label         - Label for the set.
 * @param {string[]} teamReviewers - Team members that have reviewed the file. If an empty array, will print `<empty set>` instead.
 * @param {string[]} neededTeams   - Teams that have no reviews from it's members.
 * @return {{teamReviewers, neededTeams}} `{teamReviewers, neededTeams}`.
 */
function printSet( label, teamReviewers, neededTeams ) {
	core.info( label + ' ' + ( teamReviewers.length ? teamReviewers.join( ', ' ) : '<empty set>' ) );
	return { teamReviewers, neededTeams };
}

/**
 * Build a reviewer team membership filter.
 *
 * @param {object}              config     - Requirements configuration object being processed.
 * @param {Array|string|object} teamConfig - Team name, or single-key object with a list of teams/objects, or array of such.
 * @param {string}              indent     - String for indentation.
 * @return {Function} Function to filter an array of reviewers by membership in the team(s).
 */
function buildReviewerFilter( config, teamConfig, indent ) {
	if ( typeof teamConfig === 'string' ) {
		const team = teamConfig;
		return async function ( reviewers ) {
			const members = await fetchTeamMembers( team );
			const teamReviewers = reviewers.filter( reviewer => members.includes( reviewer ) );
			const neededTeams = teamReviewers.length ? [] : [ team ];
			return printSet( `${ indent }Members of ${ team }:`, teamReviewers, neededTeams );
		};
	}

	let keys;
	try {
		keys = Object.keys( teamConfig );
		assert( keys.length === 1 );
	} catch {
		throw new RequirementError( 'Expected a team name or a single-keyed object.', {
			config: config,
			value: teamConfig,
		} );
	}

	const op = keys[ 0 ];
	let arg = teamConfig[ op ];

	// Shared validation.
	switch ( op ) {
		case 'any-of':
		case 'all-of':
		case 'is-author-or-reviewer':
			// These ops require an array of teams/objects.
			if ( ! Array.isArray( arg ) ) {
				throw new RequirementError( `Expected an array of teams, got ${ typeof arg }`, {
					config: config,
					value: arg,
				} );
			}
			if ( arg.length === 0 ) {
				throw new RequirementError( 'Expected a non-empty array of teams', {
					config: config,
					value: teamConfig,
				} );
			}
			arg = arg.map( t => buildReviewerFilter( config, t, `${ indent }  ` ) );
			break;
	}

	// Process operations.
	if ( op === 'any-of' ) {
		return async function ( reviewers ) {
			core.info( `${ indent }Union of these:` );
			const reviewersAny = await Promise.all( arg.map( f => f( reviewers, `${ indent }  ` ) ) );
			const requirementsMet = [];
			const neededTeams = [];
			for ( const requirementResult of reviewersAny ) {
				if ( requirementResult.teamReviewers.length !== 0 ) {
					requirementsMet.push( requirementResult.teamReviewers );
				}
				if ( requirementResult.neededTeams.length !== 0 ) {
					neededTeams.push( requirementResult.neededTeams );
				}
			}
			if ( requirementsMet.length > 0 ) {
				// If there are requirements met, zero out the needed teams
				neededTeams.length = 0;
			}
			return printSet(
				`${ indent }=>`,
				[ ...new Set( requirementsMet.flat( 1 ) ) ],
				[ ...new Set( neededTeams.flat( 1 ) ) ]
			);
		};
	}

	if ( op === 'all-of' ) {
		return async function ( reviewers ) {
			core.info( `${ indent }Union of these, if none are empty:` );
			const reviewersAll = await Promise.all( arg.map( f => f( reviewers, `${ indent }  ` ) ) );
			const requirementsMet = [];
			const neededTeams = [];
			for ( const requirementResult of reviewersAll ) {
				if ( requirementResult.teamReviewers.length !== 0 ) {
					requirementsMet.push( requirementResult.teamReviewers );
				}
				if ( requirementResult.neededTeams.length !== 0 ) {
					neededTeams.push( requirementResult.neededTeams );
				}
			}
			if ( neededTeams.length !== 0 ) {
				// If there are needed teams, zero out requirements met
				return printSet( `${ indent }=>`, [], [ ...new Set( neededTeams.flat( 1 ) ) ] );
			}
			return printSet( `${ indent }=>`, [ ...new Set( requirementsMet.flat( 1 ) ) ], [] );
		};
	}

	if ( op === 'is-author-or-reviewer' ) {
		return async function ( reviewers ) {
			core.info( `${ indent }Author or reviewers are union of these:` );
			const authorOrReviewers = [ ...reviewers, github.context.payload.pull_request.user.login ];
			const reviewersAny = await Promise.all(
				arg.map( f => f( authorOrReviewers, `${ indent }  ` ) )
			);
			const requirementsMet = [];
			const neededTeams = [];
			for ( const requirementResult of reviewersAny ) {
				if ( requirementResult.teamReviewers.length !== 0 ) {
					requirementsMet.push( requirementResult.teamReviewers );
				}
				if ( requirementResult.neededTeams.length !== 0 ) {
					neededTeams.push( requirementResult.neededTeams );
				}
			}
			if ( requirementsMet.length > 0 ) {
				// If there are requirements met, zero out the needed teams
				neededTeams.length = 0;
			}
			return printSet(
				`${ indent }=>`,
				[ ...new Set( requirementsMet.flat( 1 ) ) ],
				[ ...new Set( neededTeams.flat( 1 ) ) ]
			);
		};
	}

	throw new RequirementError( `Unrecognized operation "${ op }"`, {
		config: config,
		value: teamConfig,
	} );
}

/**
 * Class representing an individual requirement.
 */
class Requirement {
	/**
	 * Constructor.
	 *
	 * @param {object}          config         - Object config
	 * @param {string[]|string} config.paths   - Paths this requirement applies to. Either an array of picomatch globs, or the string "unmatched".
	 * @param {Array}           config.teams   - Team reviews requirements.
	 * @param {boolean}         config.consume - Whether matched paths should be ignored by later rules.
	 */
	constructor( config ) {
		this.name = config.name || 'Unnamed requirement';

		if ( config.paths === 'unmatched' ) {
			this.pathsFilter = null;
		} else if (
			Array.isArray( config.paths ) &&
			config.paths.length > 0 &&
			config.paths.every( v => typeof v === 'string' )
		) {
			// picomatch doesn't combine multiple negated patterns in a way that makes sense here: `!a` and `!b` will pass both `a` and `b`
			// because `a` matches `!b` and `b` matches `!a`. So instead we have to handle the negation ourself: test the (non-negated) patterns in order,
			// with the last match winning. If none match, the opposite of the first pattern's negation is what we need.
			const filters = config.paths.map( path => {
				if ( path.startsWith( '!' ) ) {
					return {
						negated: true,
						filter: picomatch( path.substring( 1 ), { dot: true, nonegate: true } ),
					};
				}
				return {
					negated: false,
					filter: picomatch( path, { dot: true } ),
				};
			} );
			const first = filters.shift();
			this.pathsFilter = v => {
				let ret = first.filter( v ) ? ! first.negated : first.negated;
				for ( const filter of filters ) {
					if ( filter.filter( v ) ) {
						ret = ! filter.negated;
					}
				}
				return ret;
			};
		} else {
			throw new RequirementError(
				'Paths must be a non-empty array of strings, or the string "unmatched".',
				{
					config: config,
				}
			);
		}

		this.reviewerFilter = buildReviewerFilter( config, { 'any-of': config.teams }, '  ' );
		this.consume = !! config.consume;
	}

	// eslint-disable-next-line jsdoc/require-returns, jsdoc/require-returns-check -- Doesn't support documentation of object structure.
	/**
	 * Test whether this requirement applies to the passed paths.
	 *
	 * @param {string[]} paths        - Paths to test against.
	 * @param {string[]} matchedPaths - Paths that have already been matched.
	 * @return {object} _ Results object.
	 * @return {boolean} _.applies Whether the requirement applies.
	 * @return {string[]} _.matchedPaths New value for `matchedPaths`.
	 * @return {string[]} _.paths New value for `paths`.
	 */
	appliesToPaths( paths, matchedPaths ) {
		let matches;
		if ( this.pathsFilter ) {
			matches = paths.filter( p => this.pathsFilter( p ) );
		} else {
			matches = paths.filter( p => ! matchedPaths.includes( p ) );
			if ( matches.length === 0 ) {
				core.info( "Matches files that haven't been matched yet, but all files have." );
			}
		}

		const ret = {
			applies: matches.length !== 0,
			matchedPaths,
			paths,
		};

		if ( ret.applies ) {
			core.info( 'Matches the following files:' );
			matches.forEach( m => core.info( `   - ${ m }` ) );
			ret.matchedPaths = [ ...new Set( [ ...matchedPaths, ...matches ] ) ].sort();

			if ( this.consume ) {
				core.info( 'Consuming matched files!' );
				ret.paths = ret.paths.filter( p => ! matches.includes( p ) );
			}
		}

		return ret;
	}

	/**
	 * Test whether this requirement is satisfied.
	 *
	 * @param {string[]} reviewers - Reviewers to test against.
	 * @return {string[]} Array of teams from which review is still needed.
	 */
	async needsReviewsFrom( reviewers ) {
		core.info( 'Checking reviewers...' );
		const checkNeededTeams = await this.reviewerFilter( reviewers );
		return checkNeededTeams.neededTeams;
	}
}

module.exports = Requirement;


/***/ }),

/***/ 46:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 491 );
const github = __nccwpck_require__( 487 );
const { WError } = __nccwpck_require__( 564 );

/**
 * Fetch the reviewers approving the current PR.
 *
 * @return {string[]} Reviewers.
 */
async function fetchReviewers() {
	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const owner = github.context.payload.repository.owner.login;
	const repo = github.context.payload.repository.name;
	const pr = github.context.payload.pull_request.number;

	const reviewers = new Set();
	try {
		for await ( const res of octokit.paginate.iterator( octokit.rest.pulls.listReviews, {
			owner: owner,
			repo: repo,
			pull_number: pr,
			per_page: 100,
		} ) ) {
			res.data.forEach( review => {
				// GitHub may return more than one review per user, but only counts the last non-comment one for each.
				// "APPROVED" allows merging, while "CHANGES_REQUESTED" and "DISMISSED" do not.
				if ( review.state === 'APPROVED' ) {
					reviewers.add( review.user.login );
				} else if ( review.state !== 'COMMENTED' ) {
					reviewers.delete( review.user.login );
				}
			} );
		}
	} catch ( error ) {
		throw new WError(
			`Failed to query ${ owner }/${ repo } PR #${ pr } reviewers from GitHub`,
			error,
			{}
		);
	}

	return [ ...reviewers ].sort();
}

module.exports = fetchReviewers;


/***/ }),

/***/ 971:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__( 491 );
const github = __nccwpck_require__( 487 );
const { WError } = __nccwpck_require__( 564 );
const addVirtualTeams = __nccwpck_require__( 950 );

const cache = {};

/**
 * Fetch the members of a team for the purpose of verifying a review Requirement.
 * Special case: Names prefixed with @ are considered to be a one-member team with the named GitHub user.
 *
 * @param {string} team - GitHub team slug, or @ followed by a GitHub user name.
 * @return {string[]} Team members.
 */
async function fetchTeamMembers( team ) {
	if ( cache[ team ] ) {
		return cache[ team ];
    }
	const octokit = github.getOctokit( core.getInput( 'token', { required: true } ) );
	const org = github.context.payload.repository.owner.login;

	let members = [];
	if ( team.startsWith( '@' ) ) {
		// Handle @singleuser virtual teams. Fetch the correct username case from GitHub
		// to avoid having to worry about edge cases and Unicode versions and such.
		try {
			const res = await octokit.rest.users.getByUsername( { username: team.slice( 1 ) } );
			members.push( res.data.login );
		} catch ( error ) {
			throw new WError(
				// prettier-ignore
				`Failed to query user ${ team } from GitHub: ${ error.response?.data?.message || error.message }`,
				error,
				{}
			);
		}
	} else if ( team.startsWith( '+' ) ) {
        // Handle #virtual teams. Fetch the correct usernames case from GitHub
        // to avoid having to worry about edge cases and Unicode versions and such.
        await addVirtualTeams( members, team );
	} else {
		try {
			for await ( const res of octokit.paginate.iterator( octokit.rest.teams.listMembersInOrg, {
				org: org,
				team_slug: team,
				per_page: 100,
			} ) ) {
				members = members.concat( res.data.map( v => v.login ) );
			}
		} catch ( error ) {
			throw new WError(
				// prettier-ignore
				`Failed to query ${ org } team ${ team } from GitHub: ${ error.response?.data?.message || error.message }`,
				error,
				{}
			);
		}
	}

	cache[ team ] = members;
	return members;
}

module.exports = fetchTeamMembers;


/***/ }),

/***/ 950:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {


const core = __nccwpck_require__( 491 );
const github = __nccwpck_require__( 487 );

const virtualTeams = {};

async function addVirtualTeams(members, team) {
    if ( ! virtualTeams ) {
        const teamsFilename = core.getInput( 'virtual-teams-file' );
        let virtualTeamsString = "";
        if ( ! teamsFilename ) {
            throw new reporter.ReportError(
                'Virtual teams are not found',
                new Error( 'To use +virtual-teams a virtual-teams-file must be provided' ),
                {}
            );
        }
        try {
            virtualTeamsString = fs.readFileSync( teamsFilename, 'utf8' );
        } catch ( error ) {
            throw new reporter.ReportError(
                `Virtual teams file ${ filename } could not be read`,
                error,
                {}
            );
        }
        try {
            virtualTeamsArray = yaml.load( virtualTeamsString, {
                onWarning: w => core.warning( `Yaml: ${ w.message }` ),
            } );
            if ( ! Array.isArray( virtualTeams ) ) {
                throw new Error( 'Virtual teams file does not contain an array' );
            }
        } catch ( error ) {
            error[ Symbol.toStringTag ] = 'Error'; // Work around weird check in WError.
            throw new reporter.ReportError( 'Virtual teams are not valid', error, {} );
        }
        for ( const vt of virtualTeamsArray ) {
            if ( vt.name.startsWith( '+' ) ) {
                virtualTeams[ vt.name ] = vt.members;
            } else {
                throw new reporter.ReportError(
                    `Virtual team ${ vt.name } does not start with +`,
                    new Error( 'Virtual teams must start with +' ),
                    {}
                );
            }
        }
    }
    for ( const member of virtualTeams[team] ) {
        try {
            const res = await octokit.rest.users.getByUsername( { username: member } );
            members.push( res.data.login );
        } catch ( error ) {
            throw new WError(
                // prettier-ignore
                `Failed to query user ${ member } from GitHub: ${ error.response?.data?.message || error.message }`,
                error,
                {}
            );
        }
    }
}

module.exports = addVirtualTeams;


/***/ }),

/***/ 491:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 487:
/***/ ((module) => {

module.exports = eval("require")("@actions/github");


/***/ }),

/***/ 564:
/***/ ((module) => {

module.exports = eval("require")("error");


/***/ }),

/***/ 361:
/***/ ((module) => {

module.exports = eval("require")("js-yaml");


/***/ }),

/***/ 792:
/***/ ((module) => {

module.exports = eval("require")("picomatch");


/***/ }),

/***/ 613:
/***/ ((module) => {

"use strict";
module.exports = require("assert");

/***/ }),

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const main_fs = __nccwpck_require__( 896 );
const core = __nccwpck_require__( 491 );
const main_yaml = __nccwpck_require__( 361 );
const main_reporter = __nccwpck_require__( 877 );
const requestReview = __nccwpck_require__( 620 );
const Requirement = __nccwpck_require__( 101 );

/**
 * Load the requirements yaml file.
 *
 * @return {Requirement[]} Requirements.
 */
async function getRequirements() {
	let requirementsString = core.getInput( 'requirements' );

	if ( ! requirementsString ) {
		const filename = core.getInput( 'requirements-file' );
		if ( ! filename ) {
			throw new main_reporter.ReportError(
				'Requirements are not found',
				new Error( 'Either `requirements` or `requirements-file` input is required' ),
				{}
			);
		}

		try {
			requirementsString = main_fs.readFileSync( filename, 'utf8' );
		} catch ( error ) {
			throw new main_reporter.ReportError(
				`Requirements file ${ filename } could not be read`,
				error,
				{}
			);
		}
	} else if ( core.getInput( 'requirements-file' ) ) {
		core.warning( 'Ignoring input `requirements-file` because `requirements` was given' );
	}

	try {
		const requirements = main_yaml.load( requirementsString, {
			onWarning: w => core.warning( `Yaml: ${ w.message }` ),
		} );
		if ( ! Array.isArray( requirements ) ) {
			throw new Error( 'Requirements file does not contain an array' );
		}

		return requirements.map( ( r, i ) => new Requirement( { name: `#${ i }`, ...r } ) );
	} catch ( error ) {
		error[ Symbol.toStringTag ] = 'Error'; // Work around weird check in WError.
		throw new main_reporter.ReportError( 'Requirements are not valid', error, {} );
	}
}

/**
 * Action entry point.
 */
async function main() {
	try {
		const requirements = await getRequirements();
		core.startGroup( `Loaded ${ requirements.length } review requirement(s)` );

		const reviewers = await __nccwpck_require__( 46 )();
		core.startGroup( `Found ${ reviewers.length } reviewer(s)` );
		reviewers.forEach( r => core.info( r ) );
		core.endGroup();

		let paths = await __nccwpck_require__( 722 )();
		core.startGroup( `PR affects ${ paths.length } file(s)` );
		paths.forEach( p => core.info( p ) );
		core.endGroup();

		let matchedPaths = [];
		const teamsNeededForReview = new Set();
		for ( let i = 0; i < requirements.length; i++ ) {
			const r = requirements[ i ];
			core.startGroup( `Checking requirement "${ r.name }"...` );
			let applies;
			( { applies, matchedPaths, paths } = r.appliesToPaths( paths, matchedPaths ) );
			if ( ! applies ) {
				core.endGroup();
				core.info( `Requirement "${ r.name }" does not apply to any files in this PR.` );
			} else {
				const neededForRequirement = await r.needsReviewsFrom( reviewers );
				core.endGroup();
				if ( neededForRequirement.length === 0 ) {
					core.info( `Requirement "${ r.name }" is satisfied by the existing reviews.` );
				} else {
					core.error( `Requirement "${ r.name }" is not satisfied by the existing reviews.` );
					neededForRequirement.forEach( teamsNeededForReview.add, teamsNeededForReview );
				}
			}
		}
		if ( teamsNeededForReview.size === 0 ) {
			await main_reporter.status( main_reporter.STATE_SUCCESS, 'All required reviews have been provided!' );
		} else {
			await main_reporter.status(
				core.getBooleanInput( 'fail' ) ? main_reporter.STATE_FAILURE : main_reporter.STATE_PENDING,
				reviewers.length ? 'Awaiting more reviews...' : 'Awaiting reviews...'
			);
			if ( core.getBooleanInput( 'request-reviews' ) ) {
				await requestReview( [ ...teamsNeededForReview ] );
			}
		}
	} catch ( error ) {
		let err, state, description;
		if ( error instanceof main_reporter.ReportError ) {
			err = error.cause();
			state = main_reporter.STATE_FAILURE;
			description = error.message;
		} else {
			err = error;
			state = main_reporter.STATE_ERROR;
			description = 'Action encountered an error';
		}
		core.setFailed( err.message );
		core.info( err.stack );
		if ( core.getInput( 'token' ) && core.getInput( 'status' ) ) {
			await main_reporter.status( state, description );
		}
	}
}

main();

module.exports = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=index.js.map