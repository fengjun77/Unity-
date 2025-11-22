
import { UserData, SavedNote, Topic, QuizQuestion } from "../types";

const DB_PREFIX = "unity_master_v2_";

export const loadUser = (username: string): UserData => {
  const data = localStorage.getItem(DB_PREFIX + username);
  if (data) {
    return JSON.parse(data);
  }
  return {
    username,
    currentDay: 1,
    savedNotes: [],
    activeSession: null
  };
};

export const saveUser = (user: UserData) => {
  localStorage.setItem(DB_PREFIX + user.username, JSON.stringify(user));
};

export const clearActiveSession = (user: UserData) => {
  const updated = { ...user, activeSession: null };
  saveUser(updated);
  return updated;
};

export const saveActiveSession = (
  user: UserData, 
  topics: Topic[], 
  questions: QuizQuestion[], 
  step: 'LEARNING' | 'QUIZ'
) => {
  const updated: UserData = {
    ...user,
    activeSession: {
      topics,
      questions,
      step
    }
  };
  saveUser(updated);
  return updated;
};

export const completeDay = (user: UserData, note: SavedNote) => {
  const updated: UserData = {
    ...user,
    currentDay: user.currentDay + 1,
    savedNotes: [...user.savedNotes, note],
    activeSession: null
  };
  saveUser(updated);
  return updated;
};

export const getAllUsers = (): string[] => {
  const users: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(DB_PREFIX)) {
      users.push(key.replace(DB_PREFIX, ''));
    }
  }
  return users;
};
