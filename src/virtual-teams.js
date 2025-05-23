
const core = require( '@actions/core' );
const github = require( '@actions/github' );
const reporter = require( './reporter.js' );
const fs = require( 'fs' );
const yaml = require( 'js-yaml' );

const virtualTeams = {};

async function addVirtualTeams(members, team) {
    if ( ! (team in virtualTeams )) {
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
                `Virtual teams file ${ teamsFilename } could not be read`,
                error,
                {}
            );
        }
        try {
            virtualTeamsArray = yaml.load( virtualTeamsString, {
                onWarning: w => core.warning( `Yaml: ${ w.message }` ),
            } );
            if ( ! Array.isArray( virtualTeamsArray ) ) {
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
    core.info( `All virtual teams ${ virtualTeams.keys() }` );
    core.info( `Adding virtual team ${ team }` );
    core.info( `Members: ${ virtualTeams[team] }` );
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
