"use client";

import { db } from "./firebase";
import {
  DocumentSnapshot,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
};

export type Cart = {
  items: CartItem[];
  total: number;
};

export type PendingStatus = "pending" | "synced";

/**
 * 冪等な会計ドキュメントを sales/{saleId} に保存する。
 * saleId はクライアント側で生成し、setDoc により同一 ID への再送を許容する。
 */
export async function saveSale(cart: Cart, uid: string) {
  const saleId = crypto.randomUUID();
  const ref = doc(db, "sales", saleId);
  await setDoc(ref, {
    items: cart.items,
    total: cart.total,
    createdAt: serverTimestamp(),
    type: "sale",
    uid,
  });
  return saleId;
}

/**
 * hasPendingWrites を監視し、ローカル未送信状態か同期済みかを通知する。
 */
export function watchSaleStatus(
  saleId: string,
  cb: (status: PendingStatus, snap: DocumentSnapshot) => void
) {
  return onSnapshot(
    doc(db, "sales", saleId),
    { includeMetadataChanges: true },
    (snap) => {
      const pending = snap.metadata.hasPendingWrites;
      cb(pending ? "pending" : "synced", snap);
    }
  );
}
