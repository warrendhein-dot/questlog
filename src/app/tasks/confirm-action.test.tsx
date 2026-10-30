import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmAction } from "./confirm-action";

function setup(action = vi.fn(async () => {})) {
  const view = render(
    <ConfirmAction
      action={action}
      fields={{ id: "abc" }}
      label="Delete forever"
      accessibleLabel="Delete forever: Pay rent"
      question={'Delete "Pay rent" for good? This cannot be undone.'}
      confirmLabel="Yes, delete forever"
    />,
  );
  return { action, ...view };
}

const ask = () => fireEvent.click(screen.getByRole("button", { name: "Delete forever: Pay rent" }));

describe("ConfirmAction", () => {
  it("starts with one button whose spoken name starts with its visible text (WCAG 2.5.3)", () => {
    setup();
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Delete forever");
    expect(button.getAttribute("aria-label")!.startsWith("Delete forever")).toBe(true);
    expect(screen.queryByText(/cannot be undone/)).not.toBeInTheDocument();
  });

  it("does NOT run the action on the first click: it asks first", async () => {
    const { action } = setup();
    ask();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText('Delete "Pay rent" for good? This cannot be undone.')).toBeVisible();
    expect(screen.getByRole("button", { name: "Yes, delete forever" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("names the question for screen readers", () => {
    setup();
    ask();
    expect(
      screen.getByRole("group", { name: 'Delete "Pay rent" for good? This cannot be undone.' }),
    ).toBeInTheDocument();
  });

  it("moves focus to Cancel, the harmless choice, when it asks", () => {
    setup();
    ask();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("runs the action, with the hidden fields, only when confirmed", async () => {
    const { action } = setup();
    ask();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, delete forever" }));
    });
    expect(action).toHaveBeenCalledTimes(1);
    const data = (action.mock.calls[0] as unknown as [FormData])[0];
    expect(data.get("id")).toBe("abc");
  });

  it("goes back, runs nothing, and returns focus to the first button when cancelled", () => {
    const { action } = setup();
    ask();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByText(/cannot be undone/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete forever: Pay rent" })).toHaveFocus();
  });

  it("does not steal focus when the page first loads", () => {
    setup();
    expect(document.body).toHaveFocus();
  });

  it("shows markup in the question as plain text", () => {
    const { container } = render(
      <ConfirmAction
        action={vi.fn(async () => {})}
        label="Delete forever"
        accessibleLabel="Delete forever: x"
        question={'Delete "<img src=x onerror=alert(1)>" for good?'}
        confirmLabel="Yes"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete forever: x" }));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  });
});
