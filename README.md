# Changed Paths Parser

Easily find which paths have changed within workflow runs.

## Usage
```yml
- name: Get Changed Paths
  uses: JoshPiper/Changed-Paths-Action@v1.1.2
  id: paths
- name: Dump Information
  run: echo "${{ toJSON(steps.paths.outputs) }}"
```

## Inputs

### github_token
[**String**] GitHub PAT or Token for authenticating with Octokit to get workflow run data.

### workflow_id
[**String: optional**] The filename of the workflow to search for prior runs of.

### filter
[**String: optional**] An fnmatch / glob filter to pass the diff'd files through before returning.

## Outputs

### files
[**String[]**] Newline Delimited Paths.
