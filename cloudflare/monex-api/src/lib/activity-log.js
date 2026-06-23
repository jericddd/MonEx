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
  user.pendingMons.push(
    ...mons.map((m) => ({ ...m, caughtAt: new Date().toISOString() }))
  );
  user.updatedAt = new Date().toISOString();
}

export function makeActivityId() {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
