import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/tasks/schema";

const { requireUser, listOpenTasks, listRecentCompletedTasks } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listOpenTasks: vi.fn(),
  listRecentCompletedTasks: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/tasks/queries", () => ({ listOpenTasks, listRecentCompletedTasks }));
vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/app/tasks/actions", () => ({
  createTask: vi.fn(),
  setTaskCompleted: vi.fn(),
}));

import Home from "./page";

const open: Task = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Pay rent",
  notes: "",
  category: "home",
  priority: "high",
  dueDate: "2026-11-01",
  completedAt: null,
};
const done: Task = {
  ...open,
  id: "223e4567-e89b-42d3-a456-426614174000",
  title: "Book dentist",
  completedAt: "2026-10-26T08:00:00Z",
};

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: "u1", email: "hero@example.com" });
  listOpenTasks.mockReset();
  listOpenTasks.mockResolvedValue([open]);
  listRecentCompletedTasks.mockReset();
  listRecentCompletedTasks.mockResolvedValue([done]);
});

describe("Home page", () => {
  it("has the app title as the main heading and a main landmark", async () => {
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "Questlog" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("shows who is signed in and offers sign-out", async () => {
    render(await Home());
    expect(screen.getByText("Signed in as hero@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("organises the page into named sections with a form for new quests", async () => {
    render(await Home());
    for (const name of ["New quest", "Open quests", "Completed"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Add quest" })).toBeInTheDocument();
  });

  it("lists open and completed quests separately", async () => {
    render(await Home());
    expect(screen.getByRole("link", { name: "Pay rent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete quest: Pay rent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book dentist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo quest: Book dentist" })).toBeInTheDocument();
  });

  it("guides a new user when there is nothing yet", async () => {
    listOpenTasks.mockResolvedValue([]);
    listRecentCompletedTasks.mockResolvedValue([]);
    render(await Home());
    expect(screen.getByText("No open quests. Add your first one above.")).toBeInTheDocument();
    expect(screen.getByText("Nothing completed yet.")).toBeInTheDocument();
  });

  it("does not render for a signed-out visitor, and loads no data", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(listOpenTasks).not.toHaveBeenCalled();
  });

  it("escapes markup in the account's email address", async () => {
    requireUser.mockResolvedValue({
      id: "u1",
      email: '<img src=x onerror="alert(1)">@example.com',
    });
    const { container } = render(await Home());
    expect(container.querySelector("img")).toBeNull();
  });
});
