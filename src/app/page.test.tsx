import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithSteps } from "@/lib/tasks/queries";

const { requireUser, getTimeZone, listOpenTasks, listRecentCompletedTasks } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getTimeZone: vi.fn(),
  listOpenTasks: vi.fn(),
  listRecentCompletedTasks: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/auth/profile", () => ({ getTimeZone }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/tasks/queries", () => ({ listOpenTasks, listRecentCompletedTasks }));
vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/app/profile/actions", () => ({ saveTimeZone: vi.fn() }));
vi.mock("@/app/tasks/actions", () => ({
  createTask: vi.fn(),
  setTaskCompleted: vi.fn(),
  setTaskPinned: vi.fn(),
  trashTask: vi.fn(),
}));

import Home from "./page";

// Wednesday 28 October 2026, midday UTC. The week runs Monday 26 October to Sunday 1 November.
const NOW = new Date("2026-10-28T12:00:00Z");

const open: TaskWithSteps = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Pay rent",
  notes: "",
  category: "home",
  priority: "high",
  dueDate: "2026-11-01",
  completedAt: null,
  pinnedFor: null,
  recurrence: null,
  stepsDone: 0,
  stepsTotal: 0,
};
const done: TaskWithSteps = {
  ...open,
  id: "223e4567-e89b-42d3-a456-426614174000",
  title: "Book dentist",
  completedAt: "2026-10-26T08:00:00Z",
};
const quest = (title: string, extra: Partial<TaskWithSteps> = {}): TaskWithSteps => ({
  ...open,
  id: crypto.randomUUID(),
  title,
  ...extra,
});

const show = async (searchParams: Record<string, string | string[] | undefined> = {}) =>
  render(await Home({ searchParams: Promise.resolve(searchParams) }));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: "u1", email: "hero@example.com" });
  getTimeZone.mockReset();
  getTimeZone.mockResolvedValue("UTC");
  listOpenTasks.mockReset();
  listOpenTasks.mockResolvedValue([open]);
  listRecentCompletedTasks.mockReset();
  listRecentCompletedTasks.mockResolvedValue([done]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Home page", () => {
  it("has the app title as the main heading and a main landmark", async () => {
    await show();
    expect(screen.getByRole("heading", { level: 1, name: "Questlog" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("shows who is signed in and offers sign-out", async () => {
    await show();
    expect(screen.getByText("Signed in as hero@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("links to the Trash", async () => {
    await show();
    expect(screen.getByRole("link", { name: "Trash" })).toHaveAttribute("href", "/trash");
  });

  it("has a form for new quests and a Completed section whichever view is chosen", async () => {
    for (const view of ["today", "week", "all"]) {
      const { unmount } = await show({ view });
      expect(screen.getByRole("heading", { level: 2, name: "New quest" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add quest" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: "Completed" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Book dentist" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Undo quest: Book dentist" })).toBeInTheDocument();
      unmount();
    }
  });

  it("guides a new user when there is nothing yet", async () => {
    listOpenTasks.mockResolvedValue([]);
    listRecentCompletedTasks.mockResolvedValue([]);
    await show({ view: "all" });
    expect(screen.getByText("No open quests. Add your first one above.")).toBeInTheDocument();
    expect(screen.getByText("Nothing completed yet.")).toBeInTheDocument();
  });

  it("does not render for a signed-out visitor, and loads no data", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(show()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(listOpenTasks).not.toHaveBeenCalled();
  });

  it("escapes markup in the account's email address", async () => {
    requireUser.mockResolvedValue({
      id: "u1",
      email: '<img src=x onerror="alert(1)">@example.com',
    });
    const { container } = await show();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("Home page views", () => {
  it("offers the three views as links, with the current one marked", async () => {
    await show({ view: "week" });
    const nav = screen.getByRole("navigation", { name: "Quest views" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Today", "This week", "All quests"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/?view=today",
      "/?view=week",
      "/?view=all",
    ]);
    expect(within(nav).getByRole("link", { name: "This week" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it.each([
    ["no view", {}],
    ["an unknown view", { view: "month" }],
    ["markup as the view", { view: "<script>" }],
    ["the view given twice", { view: ["week", "all"] }],
  ])("opens on Today for %s", async (_label, searchParams) => {
    await show(searchParams);
    expect(screen.getByRole("heading", { level: 2, name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  it("Today: tells the user plainly when nothing is due", async () => {
    await show(); // the only open quest is due on Sunday
    expect(screen.queryByRole("link", { name: "Pay rent" })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing due today/)).toBeInTheDocument();
  });

  it("Today: shows overdue quests under their own heading, then those due or pinned today", async () => {
    listOpenTasks.mockResolvedValue([
      quest("Due today", { dueDate: "2026-10-28" }),
      quest("Pinned, undated", { pinnedFor: "2026-10-28" }),
      quest("Way overdue", { dueDate: "2026-10-01" }),
      open,
    ]);
    await show();
    const region = screen.getByRole("region", { name: "Today" });
    expect(within(region).getByRole("heading", { level: 3, name: "Overdue" })).toBeInTheDocument();
    expect(
      within(region).getByRole("heading", { level: 3, name: "Due or pinned for today" }),
    ).toBeInTheDocument();
    const order = within(region)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(order).toEqual(["Way overdue", "Due today", "Pinned, undated"]);
    expect(within(region).queryByText("Pay rent")).not.toBeInTheDocument();
  });

  it("Today: offers to pin, and says which quests are pinned", async () => {
    listOpenTasks.mockResolvedValue([
      quest("Pinned one", { pinnedFor: "2026-10-28" }),
      quest("Due today", { dueDate: "2026-10-28" }),
    ]);
    await show();
    expect(screen.getByText("Pinned to today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin from today: Pinned one" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Pin to today: Due today" })).toBeVisible();
  });

  it("This week: shows overdue first, then quests due through Sunday", async () => {
    listOpenTasks.mockResolvedValue([
      open, // Sunday
      quest("Friday", { dueDate: "2026-10-30" }),
      quest("Next Monday", { dueDate: "2026-11-02" }),
      quest("Late", { dueDate: "2026-10-26" }),
    ]);
    await show({ view: "week" });
    const region = screen.getByRole("region", { name: "This week" });
    expect(within(region).getByRole("heading", { level: 3, name: "Overdue" })).toBeInTheDocument();
    expect(
      within(region).getByRole("heading", { level: 3, name: "Due this week" }),
    ).toBeInTheDocument();
    expect(
      within(region)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Late", "Friday", "Pay rent"]);
  });

  it("This week: says plainly when nothing is due, and where undated quests are", async () => {
    listOpenTasks.mockResolvedValue([quest("Undated", { dueDate: null })]);
    await show({ view: "week" });
    expect(screen.getByText(/Nothing due this week/)).toBeInTheDocument();
    expect(screen.getByText(/under All quests/)).toBeInTheDocument();
  });

  it("All quests: lists every open quest, with Complete and Pin buttons", async () => {
    listOpenTasks.mockResolvedValue([open, quest("Undated", { dueDate: null })]);
    await show({ view: "all" });
    const region = screen.getByRole("region", { name: "Open quests" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(region).getByRole("button", { name: "Complete quest: Pay rent" }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "Pin to today: Undated" }),
    ).toBeInTheDocument();
  });

  it("works out today in the user's saved time zone, not UTC", async () => {
    // 23:30 UTC on the 27th is already the 28th in Johannesburg.
    vi.setSystemTime(new Date("2026-10-27T23:30:00Z"));
    listOpenTasks.mockResolvedValue([quest("Due the 28th", { dueDate: "2026-10-28" })]);

    getTimeZone.mockResolvedValue("America/Los_Angeles");
    const first = await show();
    expect(screen.queryByRole("link", { name: "Due the 28th" })).not.toBeInTheDocument();
    first.unmount();

    getTimeZone.mockResolvedValue("Africa/Johannesburg");
    await show();
    expect(screen.getByRole("link", { name: "Due the 28th" })).toBeInTheDocument();
  });
});
