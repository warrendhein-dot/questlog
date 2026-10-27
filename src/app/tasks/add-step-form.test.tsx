import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SubtaskFormState } from "@/lib/subtasks/schema";
import { AddStepForm } from "./add-step-form";

function setup(result: SubtaskFormState) {
  const action = vi.fn(async () => result);
  render(<AddStepForm action={action} />);
  return action;
}

describe("AddStepForm", () => {
  it("has a labelled field and an Add step button", () => {
    setup({ status: "saved" });
    expect(screen.getByLabelText("New step")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add step" })).toBeInTheDocument();
  });

  it("sends the typed name to the action", async () => {
    const action = setup({ status: "saved" });
    await userEvent.type(screen.getByLabelText("New step"), "Book the venue");
    await userEvent.click(screen.getByRole("button", { name: "Add step" }));
    await vi.waitFor(() => expect(action).toHaveBeenCalled());
    const formData = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(formData.get("title")).toBe("Book the venue");
  });

  it("confirms, and empties the field ready for the next step", async () => {
    setup({ status: "saved" });
    await userEvent.type(screen.getByLabelText("New step"), "Book the venue");
    await userEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Step added.");
    expect(screen.getByLabelText("New step")).toHaveValue("");
  });

  it("shows the problem and keeps what was typed when the step is rejected", async () => {
    setup({ status: "error", message: "Give the step a name.", value: "  " });
    await userEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the step a name.");
    expect(screen.getByLabelText("New step")).toHaveValue("  ");
    expect(screen.getByLabelText("New step")).toHaveAttribute("aria-invalid", "true");
  });

  it("copes with an error that has nothing to show again", async () => {
    setup({ status: "error", message: "That quest could not be found." });
    await userEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That quest could not be found.");
    expect(screen.getByLabelText("New step")).toHaveValue("");
  });
});
