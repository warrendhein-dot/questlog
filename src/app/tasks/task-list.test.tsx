import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/tasks/schema";

vi.mock("@/app/tasks/actions", () => ({ setTaskCompleted: vi.fn() }));

import { TaskList } from "./task-list";

const task: Task = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Pay rent",
  notes: "",
  category: "home",
  priority: "high",
  dueDate: "2026-11-01",
  completedAt: null,
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
    expect(screen.getByRole("button", { name: "Reopen quest: Pay rent" })).toHaveTextContent(
      "Undo",
    );
    expect(container.querySelector('input[name="completed"]')).toHaveValue("false");
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
