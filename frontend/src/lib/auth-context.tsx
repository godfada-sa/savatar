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
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
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
    const unsubscribe = onAuthStateChanged(getAuthInstance(), async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Get or create user document
        const userRef = doc(getDb(), "users", firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {            // Create new user document
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
          await setDoc(userRef, newUserData);
        }

        // Listen to real-time wallet updates
        const unsubWallet = onSnapshot(userRef, (doc) => {
          if (doc.exists()) {
            setUserData(doc.data() as UserData);
          }
        });

        setLoading(false);
        return () => unsubWallet();
      } else {
        setUserData(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(getAuthInstance(), email, password);
  };

  const signup = async (email: string, password: string, name: string) => {
    const result = await createUserWithEmailAndPassword(getAuthInstance(), email, password);      // Update display name
    if (result.user) {
      await setDoc(doc(getDb(), "users", result.user.uid), {
        uid: result.user.uid,
        email,
        displayName: name,
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
