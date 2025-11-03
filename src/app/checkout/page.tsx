"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Spin, message, Typography } from "antd";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import VerifiedOnlyComponent from "../components/VerifiedOnlyComponent";
import styles from "./page.module.scss";
import { getAuth } from "firebase/auth";
import {
  saveSale,
  watchSaleStatus,
  subscribePendingSalesCount,
  type PendingStatus,
} from "../lib/sales";

const { Title } = Typography;

type Product = {
  id: string;
  name: string;
  price: number;
  order: number;
};

export default function CheckoutPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<{ [id: string]: number }>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<PendingStatus>("synced");
  const [currentSaleId, setCurrentSaleId] = useState<string | null>(null);
  const currentSaleIdRef = useRef<string | null>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const saleWatcherRef = useRef<{
    saleId: string;
    unsubscribe: () => void;
  } | null>(null);
  const syncedClearTimerRef = useRef<{
    saleId: string;
    timerId: ReturnType<typeof setTimeout>;
  } | null>(null);
  const updateCurrentSaleId = (value: string | null) => {
    currentSaleIdRef.current = value;
    setCurrentSaleId(value);
  };
  const clearCurrentSaleId = (saleId: string) => {
    setCurrentSaleId((prev) => {
      if (prev === saleId) {
        currentSaleIdRef.current = null;
        return null;
      }
      return prev;
    });
  };

  // 商品の読み込み
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const snapshot = await getDocs(collection(db, "products"));
        const productsData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Product, "id">),
        }));
        productsData.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        setProducts(productsData);
      } catch (error) {
        message.error("商品データの取得に失敗しました");
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePendingSalesCount(setPendingQueueCount);
    return () => {
      unsubscribe();
    };
  }, []);

  const handleQuantityChange = (id: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] || 0) + delta),
    }));
  };

  const total = products.reduce(
    (sum, product) => sum + (quantities[product.id] || 0) * product.price,
    0
  );

  const handleCheckout = async () => {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      message.error("ユーザー情報が取得できません。ログインし直してください。");
      return;
    }

    const items = products
      .filter((p) => quantities[p.id])
      .map((p) => ({
        productId: p.id,
        name: p.name,
        price: p.price,
        quantity: quantities[p.id],
        subtotal: p.price * quantities[p.id],
      }));

    if (items.length === 0) {
      message.info("商品を選択してください。");
      return;
    }

    const previousQuantities = { ...quantities };

    try {
      setSubmitting(true);
      setPendingStatus("pending");

      if (syncedClearTimerRef.current) {
        clearTimeout(syncedClearTimerRef.current.timerId);
        syncedClearTimerRef.current = null;
      }

      if (saleWatcherRef.current) {
        saleWatcherRef.current.unsubscribe();
        saleWatcherRef.current = null;
      }

      const { saleId, writePromise } = saveSale({ items, total }, currentUser.uid);
      updateCurrentSaleId(saleId);

      message.open({
        key: saleId,
        type: "info",
        content: `会計をキューに追加しました（ID: ${saleId}）。同期中…`,
        duration: 0,
      });

      setQuantities({});

      const unsubscribe = watchSaleStatus(saleId, (status) => {
        setPendingStatus(status);
        if (status === "synced") {
          message.open({
            key: saleId,
            type: "success",
            content: `会計 ${saleId} の同期が完了しました`,
          });
          if (saleWatcherRef.current?.saleId === saleId) {
            saleWatcherRef.current.unsubscribe();
            saleWatcherRef.current = null;
          }
          if (syncedClearTimerRef.current?.saleId === saleId) {
            clearTimeout(syncedClearTimerRef.current.timerId);
          }
          const timerId = setTimeout(() => {
            if (syncedClearTimerRef.current?.saleId === saleId) {
              syncedClearTimerRef.current = null;
            }
            clearCurrentSaleId(saleId);
          }, 3000);
          syncedClearTimerRef.current = { saleId, timerId };
        }
      });

      saleWatcherRef.current = { saleId, unsubscribe };

      writePromise.catch((error) => {
        console.error("会計ドキュメントの保存に失敗しました", error);
        message.open({
          key: saleId,
          type: "error",
          content: `会計 ${saleId} の保存に失敗しました。再試行してください。`,
          duration: 0,
        });
        setPendingStatus("failed");
        if (saleWatcherRef.current?.saleId === saleId) {
          saleWatcherRef.current.unsubscribe();
          saleWatcherRef.current = null;
        }
        if (syncedClearTimerRef.current?.saleId === saleId) {
          clearTimeout(syncedClearTimerRef.current.timerId);
          syncedClearTimerRef.current = null;
        }
        const isActiveSale = currentSaleIdRef.current === saleId;
        if (isActiveSale) {
          updateCurrentSaleId(null);
          setQuantities(previousQuantities);
        }
      });
    } catch (error) {
      message.error("会計処理に失敗しました");
      setPendingStatus("failed");
      updateCurrentSaleId(null);
      if (saleWatcherRef.current) {
        saleWatcherRef.current.unsubscribe();
        saleWatcherRef.current = null;
      }
      if (syncedClearTimerRef.current) {
        clearTimeout(syncedClearTimerRef.current.timerId);
        syncedClearTimerRef.current = null;
      }
      setQuantities(previousQuantities);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    return () => {
      if (saleWatcherRef.current) {
        saleWatcherRef.current.unsubscribe();
        saleWatcherRef.current = null;
      }
      if (syncedClearTimerRef.current) {
        clearTimeout(syncedClearTimerRef.current.timerId);
        syncedClearTimerRef.current = null;
      }
    };
  }, []);
  
  if (loading) {
    return (
      <main>
        <Spin className="spin">読み込み中...</Spin>
      </main>
    );
  }

  return (
    <VerifiedOnlyComponent>
      <main>
        <Title level={2} className={styles.title}>
          会計
        </Title>
        <div className={styles.cards}>
          {products.map((product) => (
            <Card key={product.id} className={styles.card}>
              <div>
                <div>
                  <div className={styles.name}>{product.name}</div>
                  <div className={styles.price}>¥{product.price}</div>
                </div>
                <div className={styles.buttons}>
                  <Button
                    color="primary"
                    variant="solid"
                    onClick={() => handleQuantityChange(product.id, -1)}
                  >
                    -
                  </Button>
                  <span className={styles.count}>
                    {quantities[product.id] || 0}
                  </span>
                  <Button
                    color="danger"
                    variant="solid"
                    onClick={() => handleQuantityChange(product.id, 1)}
                  >
                    +
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
        <div className={styles.control}>
          <div className={styles.total}>合計: ¥{total}</div>
          <Button
            type="primary"
            className="w-full"
            onClick={handleCheckout}
            disabled={total === 0}
          >
            会計する
          </Button>
          {(submitting || currentSaleId) && (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              {submitting && !currentSaleId
                ? "送信中..."
                : pendingStatus === "pending"
                ? "オフライン送信待ち…（接続復帰後に自動送信）"
                : pendingStatus === "failed"
                ? "同期エラー。内容を確認して再送してください。"
                : "同期済み"}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.6 }}>
            待機中の会計: {pendingQueueCount}件
          </div>
        </div>
      </main>
    </VerifiedOnlyComponent>
  );
}
