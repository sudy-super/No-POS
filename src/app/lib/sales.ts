"use client";

import { db } from "./firebase";
import {
  DocumentSnapshot,
  collection,
  doc,
  onSnapshot,
  query,
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

export type PendingStatus = "pending" | "synced" | "failed";

/**
 * 冪等な会計ドキュメントを sales/{saleId} に保存する。
 * saleId はクライアント側で生成し、setDoc により同一 ID への再送を許容する。
 */
export type SaveSaleResult = {
  saleId: string;
  writePromise: Promise<void>;
};

/**
 * 会計ドキュメントを非同期に保存し、即座に saleId を返す。
 * writePromise を待たなくても Firestore のローカル永続化がキューに積んでくれる。
 */
export function saveSale(cart: Cart, uid: string): SaveSaleResult {
  const saleId = crypto.randomUUID();
  const ref = doc(db, "sales", saleId);
  const writePromise = setDoc(ref, {
    items: cart.items,
    total: cart.total,
    createdAt: serverTimestamp(),
    type: "sale",
    uid,
  });
  return { saleId, writePromise };
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

/**
 * sales コレクション内でローカル未同期のドキュメント件数を購読する。
 */
export function subscribePendingSalesCount(cb: (count: number) => void) {
  const salesQuery = query(collection(db, "sales"));
  return onSnapshot(
    salesQuery,
    { includeMetadataChanges: true },
    (snapshot) => {
      const pendingCount = snapshot.docs.filter(
        (docSnap) => docSnap.metadata.hasPendingWrites
      ).length;
      cb(pendingCount);
    }
  );
}
