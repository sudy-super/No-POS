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
  const saleWatcherRef = useRef<null | (() => void)>(null);
  const syncedClearTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

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

    try {
      setSubmitting(true);
      setPendingStatus("pending");

      if (syncedClearTimerRef.current) {
        clearTimeout(syncedClearTimerRef.current);
        syncedClearTimerRef.current = null;
      }

      if (saleWatcherRef.current) {
        saleWatcherRef.current();
        saleWatcherRef.current = null;
      }

      const saleId = await saveSale({ items, total }, currentUser.uid);
      setCurrentSaleId(saleId);

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
          if (syncedClearTimerRef.current) {
            clearTimeout(syncedClearTimerRef.current);
          }
          syncedClearTimerRef.current = setTimeout(() => {
            setCurrentSaleId((prev) => (prev === saleId ? null : prev));
            syncedClearTimerRef.current = null;
          }, 3000);
          unsubscribe();
          saleWatcherRef.current = null;
        }
      });

      saleWatcherRef.current = unsubscribe;
    } catch (error) {
      message.error("会計処理に失敗しました");
      setPendingStatus("synced");
      setCurrentSaleId(null);
      if (saleWatcherRef.current) {
        saleWatcherRef.current();
        saleWatcherRef.current = null;
      }
      if (syncedClearTimerRef.current) {
        clearTimeout(syncedClearTimerRef.current);
        syncedClearTimerRef.current = null;
      }
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    return () => {
      if (saleWatcherRef.current) {
        saleWatcherRef.current();
      }
      if (syncedClearTimerRef.current) {
        clearTimeout(syncedClearTimerRef.current);
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
            disabled={total === 0 || submitting}
          >
            会計する
          </Button>
          {(submitting || currentSaleId) && (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              {submitting && !currentSaleId
                ? "送信中..."
                : pendingStatus === "pending"
                ? "オフライン送信待ち…（接続復帰後に自動送信）"
                : "同期済み"}
            </div>
          )}
        </div>
      </main>
    </VerifiedOnlyComponent>
  );
}
