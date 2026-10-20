import { Agent, copy, objectSchema, str } from "./agent.mjs";
export const fixture = {
  activeSession: "kickoff",
  meetings: [
    { id: "kickoff", date: "2026-10-20", turns: [
      { speaker: "Alex", text: 'For API-14, I own "Document retry behavior" due 2026-10-23.' },
      { speaker: "Sam", text: 'For UI-08, I own "Review empty states" due 2026-10-24.' },
      { speaker: "Alex", text: "We should improve observability someday." }
    ] },
    { id: "review", date: "2026-10-22", turns: [
      { speaker: "Alex", text: 'For API-14, I own "Document retry behavior" due 2026-10-26.' },
      { speaker: "Sam", text: "The previous UI-08 commitment still stands." }
    ] }
  ],
  tasks: {}, tickets: {}, exports: []
};
export function extractCommitments(meeting) {
  return meeting.turns.flatMap(turn => {
    const match = turn.text.match(/^For ([A-Z]+-\d+), I own "([^"]+)" due (\d{4}-\d{2}-\d{2})\.$/);
    return match ? [{ id: match[1], owner: turn.speaker, title: match[2], due: match[3], sessionId: meeting.id, evidence: turn.text }] : [];
  });
}
export function createProject(world = copy(fixture)) {
  const meetingById = id => {
    const meeting = world.meetings.find(m => m.id === id);
    if (!meeting || id !== world.activeSession) throw Error("Meeting is outside the active session");
    return meeting;
  };
  const tools = {
    read_meeting: {
      description: "Read the active synthetic meeting transcript. Statements without explicit owners and dates are not commitments.",
      parameters: objectSchema({ sessionId: str() }), execute: ({ sessionId }) => meetingById(sessionId)
    },
    recall_tasks: {
      description: "Recall persistent task memory and its evidence history.",
      parameters: objectSchema({ sessionId: str() }),
      execute: ({ sessionId }) => { meetingById(sessionId); return Object.values(world.tasks); }
    },
    record_task: {
      description: "Store or revise an explicit, evidence-backed task; retain old deadlines in history.",
      parameters: objectSchema({ id: str(), owner: str(), title: str(), due: str(), sessionId: str(), evidence: str() }),
      execute: args => {
        const meeting = meetingById(args.sessionId);
        const explicit = extractCommitments(meeting).find(task => task.id === args.id);
        if (!explicit || Object.keys(explicit).some(key => explicit[key] !== args[key])) throw Error("Task must match an explicit commitment in the source");
        const previous = world.tasks[args.id];
        if (previous && previous.observedOn > meeting.date) throw Error("Stale meeting cannot overwrite newer memory");
        if (previous?.evidence === args.evidence && previous?.sessionId === args.sessionId) return previous;
        const history = previous ? [...previous.history, { due: previous.due, sessionId: previous.sessionId, observedOn: previous.observedOn }] : [];
        world.tasks[args.id] = { ...args, observedOn: meeting.date, history };
        return world.tasks[args.id];
      },
      write: true
    },
    export_tasks: {
      description: "Simulate creating or updating local ticket records after human review. No messages or external tickets are sent.",
      parameters: objectSchema({ sessionId: str(), taskIds: { type: "array", minItems: 1, maxItems: 20, items: str() } }),
      guard: args => {
        meetingById(args.sessionId);
        if (new Set(args.taskIds).size !== args.taskIds.length) throw Error("Duplicate task ids");
        for (const id of args.taskIds) if (world.tasks[id]?.sessionId !== args.sessionId) throw Error("Only evidence-backed tasks from this session can be exported");
      },
      execute: args => {
        for (const id of args.taskIds) world.tickets[id] = {
          id, title: world.tasks[id].title, owner: world.tasks[id].owner, due: world.tasks[id].due, sourceSession: args.sessionId
        };
        world.exports.push({ sessionId: args.sessionId, taskIds: [...args.taskIds] });
        return { exported: args.taskIds, simulated: true };
      },
      write: true, approvalRequired: true
    }
  };
  const planner = async ({ observations }) => {
    const last = name => [...observations].reverse().find(o => o.tool === name && o.ok)?.result;
    if (observations.some(o => !o.ok)) return { type: "final", text: "Stopped to resolve conflicting task evidence." };
    if (!last("read_meeting")) return { type: "tool", name: "read_meeting", args: { sessionId: world.activeSession } };
    if (!last("recall_tasks")) return { type: "tool", name: "recall_tasks", args: { sessionId: world.activeSession } };
    const tasks = extractCommitments(last("read_meeting"));
    for (const task of tasks) {
      if (!observations.some(o => o.tool === "record_task" && o.ok && o.result.id === task.id)) return { type: "tool", name: "record_task", args: task };
    }
    if (!last("export_tasks")) return { type: "tool", name: "export_tasks", args: { sessionId: world.activeSession, taskIds: tasks.map(task => task.id) } };
    return { type: "final", text: tasks.length + " commitments recorded and reviewed. Previous deadlines remain in memory; unassigned suggestions were omitted." };
  };
  const validateFinal = () => {
    if (!world.exports.some(item => item.sessionId === world.activeSession)) throw Error("A reviewed export is required");
  };
  const instructions = "Read the active meeting and recall task memory. Only record explicit commitments with exact evidence. Preserve deadline revisions and request export approval.";
  return {
    world, tools, planner, validateFinal,
    instructions,
    goal: "Track commitments from " + world.activeSession + ", reconcile them with memory, and prepare a reviewed ticket export.",
    createAgent: livePlanner => new Agent({ planner: livePlanner || planner, tools, validateFinal, instructions })
  };
}
