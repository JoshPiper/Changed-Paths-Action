const core = require("@actions/core")
const github = require("@actions/github")
const {promisify} = require("util")
const exec = promisify(require("child_process").execFile)
const minimatch = require("minimatch")

function inpOrFail(input, def = null){
	let variable = core.getInput(input)
	if (!variable){
		if (def !== null){
			return def
		} else {
			throw new Error(`Failed to get input ${input}`)
		}
	}
	return variable
}

const ctx = github.context
const octokit = github.getOctokit(inpOrFail("github_token"))

const eventName = ctx.eventName
const ref = ctx.ref
const payload = ctx.payload
const repo = payload.repository
const [repoOwner, repoName] = repo.full_name.split("/", 2)

const workflow_id = inpOrFail("workflow_id", false)
let filters = inpOrFail("filter", false)
if (filters){
	filters = filters
		.split("\n")
		.map(str => str.trim())
		.filter(str => str !== "")
}
const master = repo.master_branch

let branch = false
if (ref.startsWith("refs/heads/")){
	branch = ref.replace("refs/heads/", "")
}

/**
 * Get the SHA of the last successful workflow run.
 * @returns {Promise<?string>}
 */
async function getLastWorkflowSHA(){
	if (!workflow_id || !branch){return null;}

	core.info("Fetching workflow run data.")
	let runs = await octokit.actions.listWorkflowRuns({
		owner: repoOwner,
		repo: repoName,
		branch,
		workflow_id: workflow_id,
		status: "success"
	})
	runs = runs.data.workflow_runs

	core.info("Fetching HEAD commit.")
	let heads = runs.map(run => run.head_commit)
	heads = heads.sort((a, b) => Math.sign(new Date(b.timestamp) - new Date(a.timestamp)))
	if (heads[0] !== undefined){
		core.info("Found SHA")
		return heads[0].id
	}

	core.warning("No successful workflow found.")
	return null
}

/**
 * Get the SHA of the point where this branch deviated.
 * @returns {Promise<?string>}
 */
async function getBranchDeviation(base = undefined, split = undefined){
	core.info("base", base, "default", master)
	core.info("split", split, "default", branch)
	if (base === undefined){
		base = master
	}
	if (split === undefined){
		split = branch
	}
	core.info("base", base, master)
	core.info("split", split, branch)
	if (!base || !split){return null}
	core.info(`Finding deviation between ${base} and ${split}`)

	let deviated = false
	try {
		core.info("Unshallowing Repository")
		await exec("git", ["fetch", "--unshallow"])
		await exec("git", ["branch", base, `origin/${base}`])

		core.info("Finding Merge Base")
		let deviation = await exec("git", ["merge-base", base, split])
		deviation = String(deviation.stdout).trim()
		if (deviation !== ""){
			deviated = deviation
		}
	} catch (e){
		core.error(e)
	}

	if (deviated){
		core.info(`Found Deviation SHA: ${deviated}`)
		return deviated
	} else {
		core.warning("Couldn't find deviation SHA.")
		return null
	}
}

/**
 * Get the tag name for an empty tag.
 * @returns {Promise<?string>}
 */
async function getEmptyTag(){
	try {
		core.info("Generating Empty Tree")
		let tree = await exec("git", ["hash-object", "-ttree", "/dev/null"])
		tree = tree.stdout.trim()

		core.info("Generating Tree Tag")
		await exec("git", ["tag", "empty", tree])
	} catch(e){
		core.error(e)
		return null
	}

	return "empty"
}

/**
 * Get the endpoint SHA for a branch.
 * @returns {Promise<?string>}
 */
async function getLastForBranch(){
	let last = false

	// Last Successful Run
	if (!last){
		core.startGroup("Fetching Last Successful Workflow")
		last = await getLastWorkflowSHA()
		core.endGroup()
	}

	// Branch Deviation
	if (!last){
		core.startGroup("Checking Branch Deviation")
		last = await getBranchDeviation()
		core.endGroup()
	}

	// Go vs empty tag.
	if (!last){
		core.startGroup("Creating Empty Tag")
		last = await getEmptyTag()
		core.endGroup()
	}

	if (last){
		return last
	} else {
		return null
	}
}

/**
 * Get the endpoint SHA for a pull request.
 * @returns {Promise<?string>}
 */
async function getLastForPullRequest(){
	let last = false

	// Branch Deviation
	if (!last){
		core.startGroup("Checking Branch Deviation")
		console.log(ctx)
		last = await getBranchDeviation(ctx.base_ref, ctx.head_ref)
		core.endGroup()
	}

	// Go vs empty tag.
	if (!last){
		core.startGroup("Creating Empty Tag")
		last = await getEmptyTag()
		core.endGroup()
	}

	if (last){
		return last
	} else {
		return null
	}
}

async function main(){
	let current = payload.after
	let last = false
	if (branch){
		last = await getLastForBranch()
	} else if (eventName === "pull_request"){
		last = await getLastForPullRequest()
	}

	if (!current || !last){
		core.setOutput("files", "")
		core.setFailed("Failed to get start or endpoint for diff.")
		return
	}

	core.startGroup("Testing shallowness.")
	try {
		let shallow = await exec("git", ["rev-parse", "--is-shallow-repository"])
		shallow = String(shallow.stdout).trim()
		if (shallow === "true"){
			core.info("Repository is shallow, fetching.")
			await exec("git", ["fetch", "--unshallow"])
		} else {
			core.info("Repository isn't shallow.")
		}
	} catch(e){
		core.endGroup()
		core.setFailed(e)
		return
	}
	core.endGroup()


	core.info(`Diffing between ${current} and ${last}`)
	let diff
	try {
		diff = await exec("git", ["diff", `${last}..${current}`, "--name-only"])
		diff = String(diff.stdout)
			.split("\n")
			.map(str => str.trim())
			.filter(str => str !== "")
	} catch(e){
		core.setFailed(e)
		return
	}

	if (filters){
		core.info("Filtering Output")

		let out = filters
			.map(filter => {
				let matcher = new minimatch.Minimatch(filter)
				return diff.filter(path => matcher.match(path))
			})
			.flat()

		diff = out
			.map(str => str.trim())
			.filter((path, idx) => path !== "" && out.indexOf(path) === idx)
	}

	core.startGroup("Final Diff")
	diff.map(path => core.info(path))
	core.endGroup()
	core.setOutput("files", diff.join("\n"))
}
main()
