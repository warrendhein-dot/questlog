import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TaskFormState } from "@/lib/tasks/schema";
import { TaskForm } from "./task-form";

type Action = (previous: TaskFormState, formData: FormData) => Promise<TaskFormState>;
/**
 * A stand-in for a server action. `delayMs` makes it answer late, like a real network call: the
 * form then really is "waiting" when the test looks at it, which is how the tests below catch
 * assertions that run before the answer has arrived.
 */
const fakeAction = (result: TaskFormState, delayMs = 0) =>
  vi.fn<Action>(async () => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return result;
  });

describe("TaskForm", () => {
  it("offers every field with a visible label and sensible defaults", () => {
    render(<TaskForm action={fakeAction({ status: "idle" })} submitLabel="Add quest" />);
    expect(screen.getByLabelText("Quest name")).toHaveValue("");
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Category")).toHaveValue("work");
    expect(screen.getByLabelText("Priority")).toHaveValue("normal");
    expect(screen.getByLabelText("Due date (optional)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add quest" })).toBeEnabled();
  });

  it("lists exactly the five categories and three priorities", () => {
    render(<TaskForm action={fakeAction({ status: "idle" })} submitLabel="Add quest" />);
    const options = (label: string) =>
      Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.text);
    expect(options("Category")).toEqual(["Work", "Health", "Learning", "Home", "Social"]);
    expect(options("Priority")).toEqual(["Low", "Normal", "High"]);
  });

  it("starts from the saved values when editing", () => {
    render(
      <TaskForm
        action={fakeAction({ status: "idle" })}
        submitLabel="Save changes"
        initial={{
          title: "Pay rent",
          notes: "Before the 1st",
          category: "home",
          priority: "high",
          dueDate: "2026-11-01",
        }}
      />,
    );
    expect(screen.getByLabelText("Quest name")).toHaveValue("Pay rent");
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("Before the 1st");
    expect(screen.getByLabelText("Category")).toHaveValue("home");
    expect(screen.getByLabelText("Priority")).toHaveValue("high");
    expect(screen.getByLabelText("Due date (optional)")).toHaveValue("2026-11-01");
  });

  it("submits exactly what was typed to the server action", async () => {
    const action = fakeAction({ status: "saved" });
    render(<TaskForm action={action} submitLabel="Add quest" />);
    await userEvent.type(screen.getByLabelText("Quest name"), "Slay the inbox");
    await userEvent.type(screen.getByLabelText("Notes (optional)"), "Zero unread");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "learning");
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "high");
    await userEvent.type(screen.getByLabelText("Due date (optional)"), "2026-12-24");
    await userEvent.click(screen.getByRole("button", { name: "Add quest" }));

    expect(action).toHaveBeenCalledTimes(1);
    const sent = action.mock.calls[0]![1];
    expect(Object.fromEntries(sent.entries())).toEqual({
      title: "Slay the inbox",
      notes: "Zero unread",
      category: "learning",
      priority: "high",
      dueDate: "2026-12-24",
    });
  });

  it("confirms a saved quest", async () => {
    render(<TaskForm action={fakeAction({ status: "saved" })} submitLabel="Add quest" />);
    await userEvent.click(screen.getByRole("button", { name: "Add quest" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Quest added.");
  });

  it("explains a rejected field and ties the message to it for screen readers", async () => {
    const action = fakeAction(
      {
        status: "error",
        errors: { title: "Give the quest a name." },
        values: { title: "", notes: "Keep me", category: "home", priority: "low", dueDate: "" },
      },
      50,
    );
    render(<TaskForm action={action} submitLabel="Add quest" />);
    await userEvent.click(screen.getByRole("button", { name: "Add quest" }));

    // Wait for the message itself: the field exists from the start, so waiting for the field proves
    // nothing, and the form rebuilds its fields when the answer arrives (an earlier handle on the
    // field would then point at a removed element). Look the field up only after the answer is in.
    await screen.findByText("Give the quest a name.");
    const title = screen.getByLabelText("Quest name");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription("Give the quest a name.");
    expect(screen.getByLabelText("Category")).not.toHaveAttribute("aria-invalid");
  });

  it("keeps what the user typed after a rejected submission", async () => {
    const action = fakeAction(
      {
        status: "error",
        errors: { title: "Give the quest a name." },
        values: {
          title: "",
          notes: "Keep me",
          category: "home",
          priority: "low",
          dueDate: "2026-12-24",
        },
      },
      50,
    );
    render(<TaskForm action={action} submitLabel="Add quest" />);
    await userEvent.type(screen.getByLabelText("Notes (optional)"), "Keep me");
    await userEvent.click(screen.getByRole("button", { name: "Add quest" }));

    await screen.findByText("Give the quest a name.");
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("Keep me");
    expect(screen.getByLabelText("Category")).toHaveValue("home");
    expect(screen.getByLabelText("Priority")).toHaveValue("low");
    expect(screen.getByLabelText("Due date (optional)")).toHaveValue("2026-12-24");
  });

  it("shows a general failure message as an alert", async () => {
    const action = fakeAction({
      status: "error",
      message: "Could not save the quest. Please try again.",
    });
    render(<TaskForm action={action} submitLabel="Add quest" />);
    await userEvent.click(screen.getByRole("button", { name: "Add quest" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the quest");
  });

  it("disables the button while saving, so a quest is not submitted twice", async () => {
    const action = vi.fn<Action>(() => new Promise(() => {}));
    render(<TaskForm action={action} submitLabel="Add quest" />);
    await userEvent.click(screen.getByRole("button", { name: "Add quest" }));
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
  });
});
