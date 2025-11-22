
import { UserData, SavedNote, Topic, QuizQuestion, TrackType } from "../types";

const DB_PREFIX = "unity_master_v3_"; // Increment version to force clean slate or handle migration carefully

export const loadUser = (username: string): UserData => {
  // Try loading from new prefix
  let dataStr = localStorage.getItem(DB_PREFIX + username);
  let data: any = dataStr ? JSON.parse(dataStr) : null;

  // If not found, try legacy v2 prefix to migrate
  if (!data) {
     const legacyDataStr = localStorage.getItem("unity_master_v2_" + username);
     if (legacyDataStr) {
         const legacyData = JSON.parse(legacyDataStr);
         // Migrate legacy data to new structure
         data = {
             username: legacyData.username,
             progress: {
                 UNITY: legacyData.currentDay || 1,
                 CSHARP_ALGO: 1
             },
             currentTrack: 'UNITY',
             savedNotes: legacyData.savedNotes.map((n: any) => ({...n, track: 'UNITY'})),
             activeSession: null
         };
         // Save to new prefix immediately
         saveUser(data);
     }
  }

  if (data) {
    // Ensure structure integrity if loaded from storage but fields missing
    if (!data.progress) {
        data.progress = { UNITY: data.currentDay || 1, CSHARP_ALGO: 1 };
    }
    if (!data.currentTrack) {
        data.currentTrack = 'UNITY';
    }
    return data as UserData;
  }

  return {
    username,
    progress: {
        UNITY: 1,
        CSHARP_ALGO: 1
    },
    currentTrack: 'UNITY',
    savedNotes: [],
    activeSession: null
  };
};

export const saveUser = (user: UserData) => {
  localStorage.setItem(DB_PREFIX + user.username, JSON.stringify(user));
};

export const clearActiveSession = (user: UserData) => {
  const updated: UserData = { ...user, activeSession: null };
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
      step,
      track: user.currentTrack
    }
  };
  saveUser(updated);
  return updated;
};

export const completeDay = (user: UserData, note: SavedNote) => {
  const track = user.currentTrack;
  const currentDay = user.progress[track];

  const updated: UserData = {
    ...user,
    progress: {
        ...user.progress,
        [track]: currentDay + 1
    },
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
    } else if (key && key.startsWith("unity_master_v2_")) {
        // Also show legacy users so they can be migrated on login
        const legacyName = key.replace("unity_master_v2_", "");
        if (!users.includes(legacyName)) users.push(legacyName);
    }
  }
  return users;
};
