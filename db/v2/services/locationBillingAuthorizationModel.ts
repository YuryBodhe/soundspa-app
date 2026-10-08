export function canManageLocationBilling(role: string, hasExplicitPermission: boolean): boolean {
  return role === "owner" || role === "admin" || (role === "manager" && hasExplicitPermission);
}

/** Owners alone may delegate billing authority; admins retain their existing billing reach. */
export function canDelegateLocationBilling(role: string): boolean {
  return role === "owner";
}
