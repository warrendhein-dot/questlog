import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrashedTask } from "@/lib/tasks/queries";

vi.mock("@/app/tasks/actions", () => ({
  restoreTask: vi.fn(),
  deleteTaskForever: vi.fn(),
}));

import { TrashList } from "./trash-list";

const task: TrashedTask = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Pay rent",
  notes: "",
  category: "home",
  priority: "high",
  dueDate: "2026-11-01",
  completedAt: null,
  pinnedFor: null,
  recurrence: null,
  deletedAt: "2026-10-30T23:30:00Z",
};

describe("TrashList", () => {
  it("says so when the Trash is empty", () => {
    render(<TrashList tasks={[]} timeZone="UTC" />);
    expect(screen.getByText("The Trash is empty.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists each quest with its details, written out, and no link to open it", () => {
    render(<TrashList tasks={[task]} timeZone="UTC" />);
    const item = within(screen.getByRole("listitem"));
    expect(item.getByText("Pay rent")).toBeInTheDocument();
    expect(item.queryByRole("link")).not.toBeInTheDocument();
    expect(item.getByText("Home · High priority · Due 2026-11-01")).toBeInTheDocument();
  });

  it("says when it was deleted and roughly when it will be removed, in the user's own days", () => {
    const { rerender } = render(<TrashList tasks={[task]} timeZone="UTC" />);
    expect(
      screen.getByText("Deleted 2026-10-30 · removed for good around 2026-11-29"),
    ).toBeInTheDocument();
    // 23:30 UTC is already the next day in Johannesburg.
    rerender(<TrashList tasks={[task]} timeZone="Africa/Johannesburg" />);
    expect(
      screen.getByText("Deleted 2026-10-31 · removed for good around 2026-11-30"),
    ).toBeInTheDocument();
  });

  it("says how a repeating quest repeats", () => {
    render(
      <TrashList
        tasks={[{ ...task, recurrence: { frequency: "daily", interval: 2, weekdays: [] } }]}
        timeZone="UTC"
      />,
    );
    expect(screen.getByText("Repeats every 2 days")).toBeInTheDocument();
  });

  it("offers Restore, with the quest's id, and a Delete forever that asks first", () => {
    const { container } = render(<TrashList tasks={[task]} timeZone="UTC" />);
    expect(screen.getByRole("button", { name: "Restore quest: Pay rent" })).toHaveTextContent(
      "Restore",
    );
    expect(container.querySelector('input[name="id"]')).toHaveValue(task.id);
    expect(screen.getByRole("button", { name: "Delete forever: Pay rent" })).toBeInTheDocument();
    // Nothing permanent can be reached with one click: the confirming button is not there yet.
    expect(screen.queryByRole("button", { name: /Yes, delete forever/ })).not.toBeInTheDocument();
  });

  it.each(["Restore", "Delete forever"])(
    "gives the %s button a spoken name that starts with its visible text (WCAG 2.5.3)",
    (word) => {
      render(<TrashList tasks={[task]} timeZone="UTC" />);
      const button = screen.getAllByRole("button").find((b) => b.textContent === word)!;
      expect(button.getAttribute("aria-label")!.toLowerCase().startsWith(word.toLowerCase())).toBe(
        true,
      );
    },
  );

  it("shows markup in a title as plain text", () => {
    const { container } = render(
      <TrashList tasks={[{ ...task, title: '<img src=x onerror="alert(1)">' }]} timeZone="UTC" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
  });
});
