"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  User,
} from "firebase/auth";
import { doc, runTransaction, onSnapshot } from "firebase/firestore";
import { getAuthInstance, getDb, googleProvider, appleProvider } from "./firebase";

interface Wallet {
  balanceSeconds: number;
  totalPurchased: number;
  totalUsed: number;
}

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAt: string;
  plan: "free" | "starter" | "basic" | "pro" | "creator";
  wallet: Wallet;
  promoUsed: string[];
}

interface AuthContextType {
  user: User | null;
  userData: UserData | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  // Listen to auth state
  useEffect(() => {
    let unsubscribeWallet: (() => void) | undefined;
    let generation = 0;
    const unsubscribe = onAuthStateChanged(getAuthInstance(), async (firebaseUser) => {
      const current = ++generation;
      unsubscribeWallet?.();
      unsubscribeWallet = undefined;
      setUser(firebaseUser);
      setUserData(null);

      if (firebaseUser) {
        try {
        // Get or create user document
        const userRef = doc(getDb(), "users", firebaseUser.uid);
        await runTransaction(getDb(), async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists()) {
          const newUserData = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || "",
            displayName: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
            photoURL: firebaseUser.photoURL || "",
            createdAt: new Date().toISOString(),
            plan: "starter",
            wallet: {
              balanceSeconds: 0,
              totalPurchased: 0,
              totalUsed: 0,
            },
            promoUsed: [],
          };
          tx.set(userRef, newUserData);
        }
        });
        if (current !== generation) return;

        // Listen to real-time wallet updates
        unsubscribeWallet = onSnapshot(userRef, (doc) => {
          if (doc.exists()) {
            setUserData(doc.data() as UserData);
          }
        }, () => { if (current === generation) setLoading(false); });
        } catch {
          if (current === generation) setUserData(null);
        } finally { if (current === generation) setLoading(false); }
      } else {
        setUserData(null);
        setLoading(false);
      }
    });

    return () => {
      generation++;
      unsubscribeWallet?.();
      unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(getAuthInstance(), email, password);
  };

  const signup = async (email: string, password: string, name: string) => {
    const result = await createUserWithEmailAndPassword(getAuthInstance(), email, password);      // Update display name
    if (result.user) {
      const userRef = doc(getDb(), "users", result.user.uid);
      await runTransaction(getDb(), async (tx) => {
        const snapshot = await tx.get(userRef);
        if (snapshot.exists()) { tx.update(userRef, { displayName: name.trim().slice(0, 80) }); return; }
        tx.set(userRef, {
        uid: result.user.uid,
        email,
        displayName: name.trim().slice(0, 80),
        photoURL: "",
        createdAt: new Date().toISOString(),
        plan: "starter",
        wallet: {
          balanceSeconds: 0,
          totalPurchased: 0,
          totalUsed: 0,
        },
        promoUsed: [],
      });
      });
      await sendEmailVerification(result.user);
    }
  };

  const loginWithGoogle = async () => {
    await signInWithPopup(getAuthInstance(), googleProvider);
  };

  const loginWithApple = async () => {
    await signInWithPopup(getAuthInstance(), appleProvider);
  };

  const logout = async () => {
    await signOut(getAuthInstance());
    for (const key of ["savatar-reference-image", "savatar-ai-prompt", "savatar-stream-key"]) localStorage.removeItem(key);
    setUserData(null);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(getAuthInstance(), email);
  };

  const value = {
    user,
    userData,
    loading,
    login,
    signup,
    loginWithGoogle,
    loginWithApple,
    logout,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
