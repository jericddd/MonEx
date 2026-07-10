export function getUser(state, xUserId, username, startingMonballs) {
  if (!state.users[xUserId]) {
    state.users[xUserId] = {
      username,
      monballs: startingMonballs,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    };
  } else if (username && state.users[xUserId].username !== username) {
    state.users[xUserId].username = username;
  }
  return state.users[xUserId];
}

export function addPendingMons(user, mons) {
  const batchAt = new Date().toISOString();
  user.pendingMons.push(
    ...mons.map((m) => ({
      ...m,
      pendingId: m.pendingId || `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      caughtAt: batchAt,
    }))
  );
  user.updatedAt = batchAt;
}
