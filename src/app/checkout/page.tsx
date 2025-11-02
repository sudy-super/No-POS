"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Modal, Spin, message, Typography } from "antd";
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
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [lastSaleItems, setLastSaleItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastTotal, setLastTotal] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<PendingStatus>("synced");
  const [currentSaleId, setCurrentSaleId] = useState<string | null>(null);
  const saleWatcherRef = useRef<null | (() => void)>(null);

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
  
    try {
      setSubmitting(true);
      setPendingStatus("pending");

      const saleId = await saveSale({ items, total }, currentUser.uid);
      setCurrentSaleId(saleId);

      if (saleWatcherRef.current) {
        saleWatcherRef.current();
        saleWatcherRef.current = null;
      }

      const unsubscribe = watchSaleStatus(saleId, (status) => {
        setPendingStatus(status);
        if (status === "synced") {
          unsubscribe();
          saleWatcherRef.current = null;
        }
      });

      saleWatcherRef.current = unsubscribe;

      // 在庫減算などの副作用は Cloud Functions (sales.onCreate) 等で処理する想定
      setLastSaleItems(items);
      setIsModalVisible(true);
      setLastTotal(total);
      setQuantities({});
    } catch (error) {
      message.error("会計処理に失敗しました");
      setPendingStatus("synced");
      setCurrentSaleId(null);
      if (saleWatcherRef.current) {
        saleWatcherRef.current();
        saleWatcherRef.current = null;
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
        <Modal
          title="会計完了"
          open={isModalVisible}
          onOk={() => setIsModalVisible(false)}
          onCancel={() => setIsModalVisible(false)}
          okText="OK"
        >
          <p>以下の内容で会計が完了しました：</p>
          <ul className="space-y-1 mt-2">
            {lastSaleItems.map((item, index) => (
              <li key={index}>
                {item.name} x {item.quantity} = ¥{item.subtotal}
              </li>
            ))}
          </ul>
          <div className="mt-4 text-right font-bold">合計: ¥{lastTotal}</div>
        </Modal>
      </main>
    </VerifiedOnlyComponent>
  );
}
