import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Subtask } from "@/lib/subtasks/schema";

vi.mock("@/app/tasks/actions", () => ({ setTaskCompleted: vi.fn() }));
vi.mock("@/app/tasks/subtask-actions", () => ({
  addSubtask: vi.fn(),
  setSubtaskCompleted: vi.fn(),
  removeSubtask: vi.fn(),
}));

import { StepsPanel } from "./steps-panel";

const TASK = "123e4567-e89b-42d3-a456-426614174000";
const open: Subtask = {
  id: "223e4567-e89b-42d3-a456-426614174000",
  title: "Call the landlord",
  completedAt: null,
};
const done: Subtask = {
  id: "323e4567-e89b-42d3-a456-426614174000",
  title: "Find the invoice",
  completedAt: "2026-10-27T08:00:00Z",
};

const show = (steps: Subtask[], taskCompleted = false) =>
  render(<StepsPanel taskId={TASK} taskCompleted={taskCompleted} steps={steps} />);

describe("StepsPanel", () => {
  it("invites the first step when there are none, and offers no completion", () => {
    show([]);
    expect(screen.getByText(/No steps yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add step" })).toBeInTheDocument();
    expect(screen.queryByText(/All steps done/)).not.toBeInTheDocument();
  });

  it("lists each step with its state written out, and how many are done", () => {
    show([open, done]);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("Call the landlord")).toBeInTheDocument();
    expect(within(items[0]!).getByText("To do")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Find the invoice")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 done")).toBeInTheDocument();
  });

  it("gives every button a spoken name that names the step", () => {
    show([open, done]);
    expect(
      screen.getByRole("button", { name: "Mark done step: Call the landlord" }),
    ).toHaveTextContent("Mark done");
    expect(screen.getByRole("button", { name: "Undo step: Find the invoice" })).toHaveTextContent(
      "Undo",
    );
    expect(screen.getByRole("button", { name: "Remove step: Call the landlord" })).toBeVisible();
  });

  it("sends the step's id and the new state with each tick button", () => {
    const { container } = show([open, done]);
    const forms = container.querySelectorAll("li form");
    expect(forms[0]!.querySelector('input[name="id"]')).toHaveValue(open.id);
    expect(forms[0]!.querySelector('input[name="completed"]')).toHaveValue("true");
    expect(forms[2]!.querySelector('input[name="id"]')).toHaveValue(done.id);
    expect(forms[2]!.querySelector('input[name="completed"]')).toHaveValue("false");
  });

  it.each([true, false])(
    "gives each button a spoken name that starts with its visible text (WCAG 2.5.3), done=%s",
    (isDone) => {
      show([{ ...open, completedAt: isDone ? "2026-10-27T08:00:00Z" : null }]);
      for (const button of screen.getAllByRole("button")) {
        const label = button.getAttribute("aria-label");
        if (label) {
          expect(label.toLowerCase().startsWith(button.textContent!.trim().toLowerCase())).toBe(
            true,
          );
        }
      }
    },
  );

  it("offers to complete the quest when every step is done, but does not do it", () => {
    const { container } = show([done]);
    expect(screen.getByText("All steps done. Complete the quest?")).toBeInTheDocument();
    const offer = screen.getByRole("status");
    expect(within(offer).getByRole("button", { name: "Complete quest" })).toBeInTheDocument();
    expect(offer.querySelector('input[name="id"]')).toHaveValue(TASK);
    expect(offer.querySelector('input[name="completed"]')).toHaveValue("true");
    // Nothing was submitted: the offer is only a form waiting for a click.
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("makes no offer while a step is still open", () => {
    show([open, done]);
    expect(screen.queryByText(/All steps done/)).not.toBeInTheDocument();
  });

  it("makes no offer once the quest is completed, and says so", () => {
    show([done], true);
    expect(screen.queryByText(/All steps done/)).not.toBeInTheDocument();
    expect(screen.getByText("This quest is completed.")).toBeInTheDocument();
  });

  it("shows markup in a step name as plain text", () => {
    const { container } = show([{ ...open, title: '<img src=x onerror="alert(1)">' }]);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("listitem")).toHaveTextContent('<img src=x onerror="alert(1)">');
  });
});
