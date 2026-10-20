import test from "node:test";
import assert from "node:assert/strict";
import { approve } from "../src/agent.mjs";
import { createProject, extractCommitments } from "../src/project.mjs";
async function finish(p) {
  let s = await p.createAgent().run({ goal: p.goal });
  if (s.pending) s = await p.createAgent().run({ goal: p.goal, state: s, approval: approve(s.pending, "reviewer") });
  return s;
}
test("memory is recorded while ticket creation waits for approval", async () => {
  const p = createProject(); const s = await p.createAgent().run({ goal: p.goal });
  assert.equal(s.status, "awaiting_approval"); assert.equal(Object.keys(p.world.tasks).length, 2);
  assert.equal(Object.keys(p.world.tickets).length, 0);
});
test("a later meeting revises the deadline and preserves history", async () => {
  let p = createProject(); await finish(p); p.world.activeSession = "review"; p = createProject(p.world);
  assert.equal((await finish(p)).status, "complete");
  const task = p.world.tasks["API-14"]; assert.equal(task.due, "2026-10-26"); assert.equal(task.history[0].due, "2026-10-23");
  assert.equal(p.world.tickets["API-14"].due, "2026-10-26");
});
test("vague suggestions without an owner and due date are omitted", () => {
  assert.deepEqual(extractCommitments({ id: "m", turns: [{ speaker: "Alex", text: "We should improve monitoring someday." }] }), []);
});
test("invented owners are rejected", () => {
  const p = createProject(); const task = extractCommitments(p.world.meetings[0])[0];
  assert.throws(() => p.tools.record_task.execute({ ...task, owner: "Invented" }), /explicit commitment/);
});
test("altered evidence cannot revise memory", () => {
  const p = createProject(); const task = extractCommitments(p.world.meetings[0])[0];
  assert.throws(() => p.tools.record_task.execute({ ...task, due: "2026-12-01" }), /explicit commitment/);
});
test("another session cannot be read through the active session", () => {
  assert.throws(() => createProject().tools.read_meeting.execute({ sessionId: "review" }), /active session/);
});
test("unrecorded tasks cannot be exported", () => {
  assert.throws(() => createProject().tools.export_tasks.guard({ sessionId: "kickoff", taskIds: ["missing"] }), /evidence-backed/);
});
