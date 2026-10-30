import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/tasks/schema";

const { requireUser, getTask, listSubtasks, notFound, updateTask } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getTask: vi.fn(),
  listSubtasks: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  updateTask: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/tasks/queries", () => ({ getTask }));
vi.mock("@/lib/subtasks/queries", () => ({ listSubtasks }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/app/tasks/actions", () => ({ updateTask, setTaskCompleted: vi.fn() }));
vi.mock("@/app/tasks/subtask-actions", () => ({
  addSubtask: vi.fn(),
  setSubtaskCompleted: vi.fn(),
  removeSubtask: vi.fn(),
}));

import EditTaskPage from "./page";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const task: Task = {
  id: ID,
  title: "Pay rent",
  notes: "Before the 1st",
  category: "home",
  priority: "high",
  dueDate: "2026-11-01",
  completedAt: null,
  pinnedFor: null,
  recurrence: null,
};

const renderPage = async (id: string) =>
  render(await EditTaskPage({ params: Promise.resolve({ id }) }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1" });
  getTask.mockResolvedValue(task);
  listSubtasks.mockResolvedValue([]);
  updateTask.mockImplementation(async () => ({ status: "idle" }));
});

describe("Edit quest page", () => {
  it("shows the quest's current values in the form", async () => {
    await renderPage(ID);
    expect(screen.getByRole("heading", { level: 1, name: "Edit quest" })).toBeInTheDocument();
    expect(screen.getByLabelText("Quest name")).toHaveValue("Pay rent");
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("Before the 1st");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your quests" })).toHaveAttribute("href", "/");
  });

  it("binds the form to this quest's id", async () => {
    await renderPage(ID);
    screen.getByRole("button", { name: "Save changes" }).click();
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalled());
    expect(updateTask.mock.calls[0]![0]).toBe(ID);
  });

  it("shows the quest's steps in their own section", async () => {
    listSubtasks.mockResolvedValue([
      { id: "223e4567-e89b-42d3-a456-426614174000", title: "Call the landlord", completedAt: null },
    ]);
    await renderPage(ID);
    expect(listSubtasks).toHaveBeenCalledWith(expect.anything(), ID);
    expect(screen.getByRole("heading", { level: 2, name: "Steps" })).toBeInTheDocument();
    expect(screen.getByText("Call the landlord")).toBeInTheDocument();
  });

  it("requires sign-in before looking anything up", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(renderPage(ID)).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(getTask).not.toHaveBeenCalled();
    expect(listSubtasks).not.toHaveBeenCalled();
  });

  it("shows not-found for an id that is not a UUID, without touching the database", async () => {
    await expect(renderPage("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getTask).not.toHaveBeenCalled();
    expect(listSubtasks).not.toHaveBeenCalled();
  });

  it("shows not-found when the quest does not exist or belongs to someone else", async () => {
    getTask.mockResolvedValue(null);
    await expect(renderPage(ID)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listSubtasks).not.toHaveBeenCalled();
  });
});
