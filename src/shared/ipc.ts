// Channel names, defined once so main and preload can never drift.
export const IPC = {
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsStatus: "settings:status",
  jiraTest: "jira:test",
  jiraProjects: "jira:projects",
  jiraAssignees: "jira:assignees",
  jiraBoards: "jira:boards",
  jiraCreate: "jira:create",
  llmReview: "llm:review",
  windowNew: "window:new",
  workspaceGet: "workspace:get",
  workspaceSet: "workspace:set",
  clipboardWrite: "clipboard:write",
  clipboardImage: "clipboard:image",
  openExternal: "shell:open",
} as const;
