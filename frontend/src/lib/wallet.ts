import {
  doc,
  getDoc,
  updateDoc,
  increment,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { getDb } from "./firebase";
export { CREDIT_PACKS } from "./credit-packs";
export { DECART_COST_PER_SEC } from "./credit-packs";

// ─── Add credits to user wallet ──────────────────────────
export async function addCreditsToWallet(userId: string, seconds: number, paymentRef?: string) {
  const userRef = doc(getDb(), "users", userId);
  await updateDoc(userRef, {
    "wallet.balanceSeconds": increment(seconds),
    "wallet.totalPurchased": increment(seconds),
  });

  // Log transaction
  await addDoc(collection(getDb(), "transactions"), {
    userId,
    type: "purchase",
    seconds,
    paymentRef: paymentRef || "admin",
    createdAt: serverTimestamp(),
  });
}

// ─── Deduct one second (called every second while streaming) ──────────
export async function deductSecond(userId: string): Promise<boolean> {
  const userRef = doc(getDb(), "users", userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return false;

  const data = userSnap.data();
  const balance = data?.wallet?.balanceSeconds || 0;

  if (balance <= 0) return false;

  await updateDoc(userRef, {
    "wallet.balanceSeconds": increment(-1),
    "wallet.totalUsed": increment(1),
  });

  return true;
}

// ─── Apply promo code ────────────────────────────────────
export async function applyPromoCode(userId: string, promoCode: string): Promise<{ success: boolean; message: string; bonusSeconds?: number }> {
  // Check if promo exists
  const promosRef = collection(getDb(), "promos");
  const q = query(promosRef, where("code", "==", promoCode.toUpperCase()));
  const promoSnap = await getDocs(q);

  if (promoSnap.empty) {
    return { success: false, message: "Invalid promo code" };
  }

  const promoDoc = promoSnap.docs[0];
  const promoData = promoDoc.data();

  // Check if promo is active
  if (!promoData.active) {
    return { success: false, message: "This promo has expired" };
  }

  // Check max uses
  if (promoData.maxUses && promoData.usedCount >= promoData.maxUses) {
    return { success: false, message: "This promo has reached its usage limit" };
  }

  // Check if user already used this promo
  const userRef = doc(getDb(), "users", userId);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.data();
  const promoUsed = userData?.promoUsed || [];

  if (promoUsed.includes(promoCode.toUpperCase())) {
    return { success: false, message: "You have already used this promo code" };
  }

  // Apply promo — add bonus seconds
  const bonusSeconds = promoData.bonusSeconds || 0;
  const discountPercent = promoData.discountPercent || 0;

  if (bonusSeconds > 0) {
    await addCreditsToWallet(userId, bonusSeconds, `promo:${promoCode}`);
  }

  // Mark promo as used by this user
  await updateDoc(userRef, {
    promoUsed: [...promoUsed, promoCode.toUpperCase()],
  });

  // Increment promo usage count
  await updateDoc(doc(getDb(), "promos", promoDoc.id), {
    usedCount: increment(1),
  });

  const message = discountPercent > 0
    ? `${discountPercent}% discount applied!`
    : `+${bonusSeconds} seconds added to your wallet!`;

  return { success: true, message, bonusSeconds };
}

// ─── Admin: Create promo code ────────────────────────────
export async function createPromoCode(data: {
  code: string;
  discountPercent?: number;
  bonusSeconds?: number;
  maxUses?: number;
  expiresAt?: string;
}) {
  return addDoc(collection(getDb(), "promos"), {
    code: data.code.toUpperCase(),
    discountPercent: data.discountPercent || 0,
    bonusSeconds: data.bonusSeconds || 0,
    maxUses: data.maxUses || null,
    usedCount: 0,
    active: true,
    createdAt: serverTimestamp(),
    expiresAt: data.expiresAt || null,
  });
}

// ─── Admin: Credit user manually ─────────────────────────
export async function adminCreditUser(userId: string, seconds: number, reason: string) {
  await addCreditsToWallet(userId, seconds, `admin:${reason}`);

  // Log admin action
  await addDoc(collection(getDb(), "adminLogs"), {
    action: "credit_user",
    userId,
    seconds,
    reason,
    createdAt: serverTimestamp(),
  });
}

// ─── Admin: Get user by email ────────────────────────────
export async function getUserByEmail(email: string) {
  const usersRef = collection(getDb(), "users");
  const q = query(usersRef, where("email", "==", email));
  const snap = await getDocs(q);

  if (snap.empty) return null;

  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── Streaming debit loop ────────────────────────────────
export function startDebitLoop(
  userId: string,
  onTick: (balance: number) => void,
  onInsufficient: () => void
): () => void {
  let running = true;

  const tick = async () => {
    if (!running) return;

    const userRef = doc(getDb(), "users", userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      onInsufficient();
      return;
    }

    const balance = userSnap.data()?.wallet?.balanceSeconds || 0;

    if (balance <= 0) {
      onInsufficient();
      return;
    }

    await deductSecond(userId);
    onTick(balance - 1);

    // Schedule next tick
    if (running) {
      setTimeout(tick, 1000);
    }
  };

  // Start the loop
  tick();

  // Return cleanup function
  return () => {
    running = false;
  };
}
