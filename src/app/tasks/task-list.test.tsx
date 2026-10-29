import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithSteps } from "@/lib/tasks/queries";

vi.mock("@/app/tasks/actions", () => ({ setTaskCompleted: vi.fn(), setTaskPinned: vi.fn() }));

import { TaskList } from "./task-list";

const task: TaskWithSteps = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Pay rent",
  notes: "",
  category: "home",
  priority: "high",
  dueDate: "2026-11-01",
  completedAt: null,
  pinnedFor: null,
  stepsDone: 0,
  stepsTotal: 0,
};

describe("TaskList", () => {
  it("shows the empty message when there are no quests", () => {
    render(<TaskList tasks={[]} mode="open" emptyMessage="No open quests." />);
    expect(screen.getByText("No open quests.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists each quest with its category, priority and due date written out", () => {
    render(<TaskList tasks={[task]} mode="open" emptyMessage="" />);
    const item = within(screen.getByRole("listitem"));
    expect(item.getByRole("link", { name: "Pay rent" })).toHaveAttribute(
      "href",
      "/tasks/123e4567-e89b-42d3-a456-426614174000",
    );
    expect(item.getByText("Home · High priority · Due 2026-11-01")).toBeInTheDocument();
  });

  it("leaves out the due date when there is none", () => {
    render(<TaskList tasks={[{ ...task, dueDate: null }]} mode="open" emptyMessage="" />);
    expect(screen.getByText("Home · High priority")).toBeInTheDocument();
  });

  it("says how many steps are done when a quest has steps", () => {
    render(
      <TaskList tasks={[{ ...task, stepsDone: 2, stepsTotal: 5 }]} mode="open" emptyMessage="" />,
    );
    expect(screen.getByText("Steps: 2 of 5 done")).toBeInTheDocument();
  });

  it("says nothing about steps when a quest has none", () => {
    render(<TaskList tasks={[task]} mode="open" emptyMessage="" />);
    expect(screen.queryByText(/Steps:/)).not.toBeInTheDocument();
  });

  it("offers a Complete button that names the quest, for screen readers", () => {
    const { container } = render(<TaskList tasks={[task]} mode="open" emptyMessage="" />);
    expect(screen.getByRole("button", { name: "Complete quest: Pay rent" })).toHaveTextContent(
      "Complete",
    );
    expect(container.querySelector('input[name="id"]')).toHaveValue(task.id);
    expect(container.querySelector('input[name="completed"]')).toHaveValue("true");
  });

  it("offers Undo for completed quests", () => {
    const { container } = render(<TaskList tasks={[task]} mode="done" emptyMessage="" />);
    expect(screen.getByRole("button", { name: "Undo quest: Pay rent" })).toHaveTextContent("Undo");
    expect(container.querySelector('input[name="completed"]')).toHaveValue("false");
  });

  it.each(["open", "done"] as const)(
    "gives each %s-mode button a spoken name that contains its visible text (WCAG 2.5.3)",
    (mode) => {
      // Voice-control users say the visible word ("click Undo"), so the accessible name must contain it.
      render(<TaskList tasks={[task]} mode={mode} emptyMessage="" />);
      const button = screen.getByRole("button");
      const visible = button.textContent!.trim().toLowerCase();
      expect(button.getAttribute("aria-label")!.toLowerCase()).toContain(visible);
    },
  );

  describe("pinning to today", () => {
    const TODAY = "2026-10-28";

    it("offers a Pin to today button that names the quest, when the list knows today's date", () => {
      const { container } = render(
        <TaskList tasks={[task]} mode="open" emptyMessage="" today={TODAY} />,
      );
      expect(screen.getByRole("button", { name: "Pin to today: Pay rent" })).toHaveTextContent(
        "Pin to today",
      );
      const forms = container.querySelectorAll("form");
      expect(forms[1]!.querySelector('input[name="id"]')).toHaveValue(task.id);
      expect(forms[1]!.querySelector('input[name="pinned"]')).toHaveValue("true");
      expect(screen.queryByText("Pinned to today")).not.toBeInTheDocument();
    });

    it("offers Unpin, and writes it out, for a quest pinned to today", () => {
      const { container } = render(
        <TaskList
          tasks={[{ ...task, pinnedFor: TODAY }]}
          mode="open"
          emptyMessage=""
          today={TODAY}
        />,
      );
      expect(screen.getByText("Pinned to today")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Unpin from today: Pay rent" })).toHaveTextContent(
        "Unpin",
      );
      expect(
        container.querySelectorAll("form")[1]!.querySelector('input[name="pinned"]'),
      ).toHaveValue("false");
    });

    it("treats a pin from another day as not pinned", () => {
      render(
        <TaskList
          tasks={[{ ...task, pinnedFor: "2026-10-27" }]}
          mode="open"
          emptyMessage=""
          today={TODAY}
        />,
      );
      expect(screen.getByRole("button", { name: "Pin to today: Pay rent" })).toBeInTheDocument();
      expect(screen.queryByText("Pinned to today")).not.toBeInTheDocument();
    });

    it("shows no pin buttons when no date is given, or for completed quests", () => {
      const { rerender } = render(<TaskList tasks={[task]} mode="open" emptyMessage="" />);
      expect(screen.queryByRole("button", { name: /Pin to today/ })).not.toBeInTheDocument();
      rerender(<TaskList tasks={[task]} mode="done" emptyMessage="" today={TODAY} />);
      expect(screen.queryByRole("button", { name: /Pin to today/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Unpin/ })).not.toBeInTheDocument();
    });

    it.each([true, false])(
      "gives each pin button a spoken name that starts with its visible text (WCAG 2.5.3), pinned=%s",
      (pinned) => {
        render(
          <TaskList
            tasks={[{ ...task, pinnedFor: pinned ? TODAY : null }]}
            mode="open"
            emptyMessage=""
            today={TODAY}
          />,
        );
        for (const button of screen.getAllByRole("button")) {
          const visible = button.textContent!.trim().toLowerCase();
          expect(button.getAttribute("aria-label")!.toLowerCase().startsWith(visible)).toBe(true);
        }
      },
    );
  });

  it("shows markup in a title as plain text", () => {
    const { container } = render(
      <TaskList
        tasks={[{ ...task, title: '<img src=x onerror="alert(1)">' }]}
        mode="open"
        emptyMessage=""
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link")).toHaveTextContent('<img src=x onerror="alert(1)">');
  });
});
