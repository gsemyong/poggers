kind: breaking
summary: Remove redundant authoring and configuration surfaces while preserving the Program, Feature, System, and adapter architecture.

UI meaning is now owned only by a Platform and inferred through each Environment.
Feature and App construction use one factory convention, and package source
resolution is checked against the published export map.
