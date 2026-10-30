import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrashedTask } from "@/lib/tasks/queries";

const { requireUser, listTrashedTasks, getTimeZone } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listTrashedTasks: vi.fn(),
  getTimeZone: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/auth/profile", () => ({ getTimeZone }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/tasks/queries", () => ({ listTrashedTasks }));
vi.mock("@/app/tasks/actions", () => ({
  restoreTask: vi.fn(),
  deleteTaskForever: vi.fn(),
  emptyTrash: vi.fn(),
}));

import TrashPage from "./page";

const task = (n: number): TrashedTask => ({
  id: `123e4567-e89b-42d3-a456-42661417400${n}`,
  title: `Quest ${n}`,
  notes: "",
  category: "work",
  priority: "normal",
  dueDate: null,
  completedAt: null,
  pinnedFor: null,
  recurrence: null,
  deletedAt: "2026-10-30T10:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1" });
  getTimeZone.mockResolvedValue("UTC");
  listTrashedTasks.mockResolvedValue([]);
});

describe("Trash page", () => {
  it("requires sign-in before looking anything up", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(TrashPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(listTrashedTasks).not.toHaveBeenCalled();
  });

  it("has a main landmark and a heading, and explains the 30 days", async () => {
    render(await TrashPage());
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Trash" })).toBeInTheDocument();
    expect(screen.getByText(/stay here for 30 days/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your quests" })).toHaveAttribute("href", "/");
  });

  it("says the Trash is empty, and offers nothing to empty", async () => {
    render(await TrashPage());
    expect(screen.getByText("The Trash is empty.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Empty Trash/ })).not.toBeInTheDocument();
  });

  it("lists what is in the Trash, using the user's time zone", async () => {
    listTrashedTasks.mockResolvedValue([task(1), task(2)]);
    getTimeZone.mockResolvedValue("Africa/Johannesburg");
    render(await TrashPage());
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Quest 1")).toBeInTheDocument();
    expect(getTimeZone).toHaveBeenCalled();
  });

  it("offers Empty Trash, which asks first and says how many it would delete", async () => {
    listTrashedTasks.mockResolvedValue([task(1), task(2)]);
    render(await TrashPage());
    const button = screen.getByRole("button", { name: /Empty Trash/ });
    expect(button).toHaveTextContent("Empty Trash");
    expect(button.getAttribute("aria-label")!.startsWith("Empty Trash")).toBe(true);
    expect(screen.queryByRole("button", { name: "Yes, empty the Trash" })).not.toBeInTheDocument();
    button.click();
    expect(
      await screen.findByText("Delete all 2 quests in the Trash for good? This cannot be undone."),
    ).toBeInTheDocument();
  });

  it("says 'quest' for a Trash of one", async () => {
    listTrashedTasks.mockResolvedValue([task(1)]);
    render(await TrashPage());
    screen.getByRole("button", { name: /Empty Trash/ }).click();
    expect(
      await screen.findByText("Delete all 1 quest in the Trash for good? This cannot be undone."),
    ).toBeInTheDocument();
  });
});
