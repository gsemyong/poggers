kind: breaking
summary: Remove the pre-release Workflow Feature and its specialized runtime.

# Workflow Removal

The experimental `createWorkflow` factory, testing helpers, and specialized
development and native runtimes have been removed. They duplicated durable
coordination machinery that now has a stronger foundation in the Actor Feature.

Applications that need durable orchestration should model it with Actors and
ordinary typed Dependencies for now. A future orchestration Feature may provide
a higher-level procedural API over that foundation without adding a second
runtime or compiler path.
