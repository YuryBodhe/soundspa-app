export type VisibilityChoice = "public" | "private" | "disabled";

export type VisibilityConfirmationState = {
  selectedVisibility: VisibilityChoice;
  confirmedVisibility: VisibilityChoice | null;
};

export type VisibilityConfirmationAction =
  | { type: "select"; visibility: VisibilityChoice }
  | { type: "confirm"; confirmed: boolean }
  | { type: "saved" };

/** Bind confirmation to the exact visibility choice and consume it after save. */
export function productVisibilityConfirmationReducer(
  state: VisibilityConfirmationState,
  action: VisibilityConfirmationAction,
): VisibilityConfirmationState {
  if (action.type === "select") {
    return action.visibility === state.selectedVisibility
      ? state
      : { selectedVisibility: action.visibility, confirmedVisibility: null };
  }
  if (action.type === "confirm") {
    return { ...state, confirmedVisibility: action.confirmed ? state.selectedVisibility : null };
  }
  return { ...state, confirmedVisibility: null };
}
