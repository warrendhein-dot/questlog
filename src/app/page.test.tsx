import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home page", () => {
  it("shows the app title as the main heading", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: "Questlog" })).toBeInTheDocument();
  });

  it("has a main landmark for screen-reader navigation", () => {
    render(<Home />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
