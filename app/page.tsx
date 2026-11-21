"use client";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { generateReactHelpers } from "@uploadthing/react";
import type { AnyFileRoute } from "uploadthing/types";
import {
  Download,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock3,
  Eye,
  EyeOff,
  Flame,
  Facebook,
  List,
  LogOut,
  MapPin,
  PackageCheck,
  Plus,
  ShoppingBag,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { auth, db, firebaseEnabled } from "@/lib/firebase";

const uploadThingUrl = process.env.NEXT_PUBLIC_UPLOADTHING_URL || "";
const uploadThingConfigured = Boolean(uploadThingUrl);
type CkbUploadRouter = { productImage: AnyFileRoute };
const { uploadFiles } = generateReactHelpers<CkbUploadRouter>({ url: uploadThingUrl || "/api/uploadthing" });

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  saleType: "regular" | "promo";
  promoFrom?: string;
  promoTo?: string;
  imageUrl: string;
  active: boolean;
};

type Profile = {
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  address: string;
  phone: string;
  email: string;
};

type CustomerOrder = {
  id: string;
  userId: string;
  customer: string;
  address: string;
  phone: string;
  productId: string;
  productName: string;
  imageUrl: string;
  quantity: number;
  total: number;
  downpayment?: number;
  pickupDate: string;
  pickupTime: string;
  paymentStatus: "paid" | "due";
  status: "pending" | "delivered" | "cancelled";
  deliveredAt?: number;
  createdAt: number;
  cancelledAt?: number | Timestamp;
};

type Tab = "shop" | "orders" | "admin";
type AuthMode = "login" | "signup";

const retiredSampleProductIds = new Set(["whole-lechon", "lechon-belly", "crispy-sisig"]);
const manilaUtcOffsetMs = 8 * 60 * 60 * 1000;

const blankProfile: Profile = { firstName: "", middleName: "", lastName: "", suffix: "", address: "", phone: "", email: "" };
const peso = (value: number) => `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const orderCancellationWindowMs = 2 * 60 * 60 * 1000;
const productCollection = () => collection(db!, "products");
const orderCollection = () => collection(db!, "orders");
const profilePath = (uid: string) => doc(db!, "users", uid);

function displayName(profile: Profile) {
  return [profile.firstName, profile.middleName, profile.lastName, profile.suffix].filter(Boolean).join(" ");
}

function formatDate(value: string) {
  if (!value) return "Choose a pickup day";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: string) {
  return new Date(`2000-01-01T${value}`).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function manilaDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function millisecondsUntilNextManilaMidnight(date: Date) {
  const manilaClock = new Date(date.getTime() + manilaUtcOffsetMs);
  const nextMidnight = Date.UTC(manilaClock.getUTCFullYear(), manilaClock.getUTCMonth(), manilaClock.getUTCDate() + 1);
  return nextMidnight - manilaClock.getTime();
}

function localMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatCalendarDate(value: string, options: Intl.DateTimeFormatOptions) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-PH", options);
}

function canCancelOrder(order: CustomerOrder, now: number) {
  const age = now - order.createdAt;
  return order.status === "pending" && age >= 0 && age <= orderCancellationWindowMs;
}

function orderBalance(order: CustomerOrder) {
  return order.paymentStatus === "paid" ? 0 : Math.max(0, order.total - (order.downpayment ?? 0));
}

function isPromoExpired(product: Product, dateKey: string) {
  return product.saleType === "promo" && Boolean(product.promoTo && dateKey > product.promoTo);
}

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [profile, setProfile] = useState<Profile>(blankProfile);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState(false);
  const [demoMode, setDemoMode] = useState<"customer" | "admin" | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("shop");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [postAuthTab, setPostAuthTab] = useState<Tab | null>(null);
  const [orderProduct, setOrderProduct] = useState<Product | null>(null);
  const [cancelOrderConfirmation, setCancelOrderConfirmation] = useState<CustomerOrder | null>(null);
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false);
  const [downpaymentQrOpen, setDownpaymentQrOpen] = useState(false);
  const [locationMapOpen, setLocationMapOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authProfile, setAuthProfile] = useState<Profile>(blankProfile);
  const [authPassword, setAuthPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [productDraft, setProductDraft] = useState<Product | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [orderQuantity, setOrderQuantity] = useState(1);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [today, setToday] = useState("");
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState("");
  const [selectedPickupDate, setSelectedPickupDate] = useState("");

  useEffect(() => {
    const now = new Date();
    setCurrentTime(now.getTime());
    setCalendarMonth(localMonthKey(now));
    setSelectedPickupDate(localDateKey(now));
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    let midnightTimer: number;
    const updateManilaDate = () => {
      const currentDate = new Date();
      setToday(manilaDateKey(currentDate));
      midnightTimer = window.setTimeout(updateManilaDate, millisecondsUntilNextManilaMidnight(currentDate) + 25);
    };
    updateManilaDate();
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(midnightTimer);
    };
  }, []);

  useEffect(() => {
    if (!firebaseEnabled || !auth || !db) return;
    return onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setDemoMode(null);
      if (!user) {
        setProfile(blankProfile);
        setAdmin(false);
        setActiveTab("shop");
        setOrders([]);
        return;
      }
      const token = await user.getIdTokenResult();
      const isStaff = token.claims.admin === true;
      setAdmin(isStaff);
      if (isStaff) setActiveTab("admin");
      const userSnapshot = await getDoc(profilePath(user.uid));
      if (userSnapshot.exists()) setProfile(userSnapshot.data() as Profile);
    });
  }, []);

  useEffect(() => {
    if (!firebaseEnabled || !db || demoMode) return;
    const productsQuery = admin ? productCollection() : query(productCollection(), where("active", "==", true));
    const stopProducts = onSnapshot(productsQuery, (snapshot) => {
      const list = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as Product)
        .filter((item) => !retiredSampleProductIds.has(item.id) && (admin || item.active))
        .sort((left, right) => left.name.localeCompare(right.name));
      setProducts(list);
    });
    let stopOrders: (() => void) | undefined;
    if (currentUser) {
      const ordersQuery = admin ? orderCollection() : query(orderCollection(), where("userId", "==", currentUser.uid));
      stopOrders = onSnapshot(ordersQuery, (snapshot) => {
        const list = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as CustomerOrder)
          .filter((item) => admin || item.userId === currentUser.uid)
          .sort((left, right) => right.createdAt - left.createdAt);
        setOrders(list);
      });
    } else {
      setOrders([]);
    }
    return () => {
      stopProducts();
      stopOrders?.();
    };
  }, [admin, currentUser, demoMode]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function showSignIn(mode: AuthMode = "login") {
    setAuthMode(mode);
    setAuthError("");
    setAuthProfile(blankProfile);
    setAuthPassword("");
    setConfirmPassword("");
    setShowAuthPassword(false);
    setShowConfirmPassword(false);
    setAuthOpen(true);
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    if (!auth || !authProfile.email || !authProfile.phone || !authProfile.firstName || !authProfile.lastName || !authPassword || !authProfile.address) {
      setAuthError("Please complete your name, address, contact number, email, and password.");
      return;
    }
    if (authPassword.length < 6 || authPassword !== confirmPassword) {
      setAuthError("Passwords must match and have at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, authProfile.email.trim().toLowerCase(), authPassword);
      await setDoc(profilePath(credential.user.uid), {
        ...authProfile,
        email: authProfile.email.trim().toLowerCase(),
        role: "user",
        createdAt: Date.now(),
      });
      setProfile({ ...authProfile, email: authProfile.email.trim().toLowerCase() });
      setAuthOpen(false);
      if (postAuthTab) setActiveTab(postAuthTab);
      setPostAuthTab(null);
      setNotice("Your account is ready. Welcome to CKB Lechon!");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    setBusy(true);
    setAuthError("");
    try {
      const result = await signInWithEmailAndPassword(auth, authProfile.email.trim().toLowerCase(), authPassword);
      const data = await getDoc(profilePath(result.user.uid));
      if (data.exists()) setProfile(data.data() as Profile);
      setAuthOpen(false);
      const token = await result.user.getIdTokenResult();
      const isStaff = token.claims.admin === true;
      if (isStaff) {
        setAdmin(true);
        setActiveTab("admin");
      } else if (postAuthTab) {
        setActiveTab(postAuthTab);
      }
      setPostAuthTab(null);
      setNotice("You're signed in. Let's find something delicious.");
    } catch (error) {
      setAuthError(error instanceof Error && error.message.includes("invalid-credential")
        ? "That email and password don't match. New here? Create an account to get started."
        : error instanceof Error ? error.message : "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orderProduct || !pickupDate || !pickupTime) return;
    if (isPromoExpired(orderProduct, manilaDateKey(new Date()))) {
      setOrderProduct(null);
      setNotice("This promo has ended and is no longer available.");
      return;
    }
    if (!Number.isInteger(orderQuantity) || orderQuantity < 1 || orderQuantity > 99) {
      setNotice("Choose a quantity from 1 to 99.");
      return;
    }
    const order: Omit<CustomerOrder, "id"> = {
      userId: currentUser?.uid ?? "demo-customer",
      customer: displayName(profile) || "Alex Customer",
      address: profile.address || "San Juan, Metro Manila",
      phone: profile.phone || "+639171234567",
      productId: orderProduct.id,
      productName: orderProduct.name,
      imageUrl: orderProduct.imageUrl,
      quantity: orderQuantity,
      total: orderProduct.price * orderQuantity,
      downpayment: 0,
      pickupDate,
      pickupTime,
      paymentStatus: "due",
      status: "pending",
      createdAt: Date.now(),
    };
    setBusy(true);
    try {
      if (demoMode) {
        const nextOrders = [{ ...order, id: crypto.randomUUID() }, ...orders];
        setOrders(nextOrders);
        localStorage.setItem("ckb-demo-orders", JSON.stringify(nextOrders));
      } else if (db && currentUser) {
        await addDoc(orderCollection(), order);
      } else {
        setBusy(false);
        showSignIn("login");
        return;
      }
      setActiveTab("orders");
      setOrderProduct(null);
      setOrderQuantity(1);
      setPickupDate("");
      setPickupTime("");
      setNotice("Pickup booked. We'll have it ready for you!");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We couldn't place that order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productDraft) return;
    setBusy(true);
    try {
      let imageUrl = productDraft.imageUrl;
      if (imageFile) {
        if (demoMode) {
          imageUrl = URL.createObjectURL(imageFile);
        } else {
          if (!uploadThingConfigured || !currentUser) throw new Error("Product image uploads are not configured yet.");
          setUploadingImage(true);
          const uploaded = await uploadFiles("productImage", {
            files: [imageFile],
            headers: async () => ({ Authorization: `Bearer ${await currentUser.getIdToken()}` }),
          });
          const file = uploaded?.[0] as { serverData?: { imageUrl?: string }; ufsUrl?: string; url?: string } | undefined;
          imageUrl = file?.serverData?.imageUrl ?? file?.ufsUrl ?? file?.url ?? "";
          if (!imageUrl) throw new Error("The image uploaded, but its URL was not returned.");
        }
      }
      const { id, ...data } = { ...productDraft, imageUrl, active: true };
      if (demoMode) {
        const next = editingProduct ? products.map((item) => item.id === id ? { id, ...data } : item) : [...products, { id: crypto.randomUUID(), ...data }];
        setProducts(next);
        localStorage.setItem("ckb-demo-products", JSON.stringify(next));
      } else if (db && currentUser && admin) {
        if (editingProduct) await updateDoc(doc(db, "products", id), data);
        else await addDoc(productCollection(), data);
      } else {
        setNotice("Admin access is required to manage menu items.");
        return;
      }
      setProductDraft(null);
      setEditingProduct(null);
      setImageFile(null);
      setNotice(editingProduct ? "Menu item updated." : "New menu item added.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save this menu item.");
    } finally {
      setUploadingImage(false);
      setBusy(false);
    }
  }

  async function archiveProduct(product: Product) {
    if (demoMode) {
      const next = products.filter((item) => item.id !== product.id);
      setProducts(next);
      localStorage.setItem("ckb-demo-products", JSON.stringify(next));
    } else if (db && admin) {
      await updateDoc(doc(db, "products", product.id), { active: false });
    }
    setNotice("Menu item removed from the shop.");
  }

  async function updateOrder(id: string, changes: Partial<CustomerOrder>) {
    if (demoMode) {
      const nextOrders = orders.map((item) => item.id === id ? { ...item, ...changes } : item);
      setOrders(nextOrders);
      localStorage.setItem("ckb-demo-orders", JSON.stringify(nextOrders));
    } else if (db && admin) {
      await updateDoc(doc(db, "orders", id), changes);
    }
    setNotice("Order updated.");
  }

  async function saveDownpayment(order: CustomerOrder, input: HTMLInputElement) {
    const enteredValue = input.value.trim();
    const amount = Number(enteredValue);
    if (!enteredValue || !Number.isFinite(amount) || amount < 0 || amount > order.total) {
      input.value = String(order.downpayment ?? 0);
      setNotice(`Enter a downpayment from ₱0 to ${peso(order.total)}.`);
      return;
    }
    const normalizedAmount = Math.round(amount * 100) / 100;
    input.value = String(normalizedAmount);
    if (normalizedAmount === (order.downpayment ?? 0)) return;
    try {
      await updateOrder(order.id, { downpayment: normalizedAmount });
    } catch (error) {
      input.value = String(order.downpayment ?? 0);
      setNotice(error instanceof Error ? error.message : "Unable to save the downpayment.");
    }
  }

  function requestOrderCancellation(order: CustomerOrder) {
    const ownerId = currentUser?.uid ?? (demoMode === "customer" ? "demo-customer" : null);
    if (!ownerId || order.userId !== ownerId) return;
    if (!canCancelOrder(order, Date.now())) {
      setNotice("Orders can only be cancelled within two hours of placing them.");
      return;
    }
    setCancelOrderConfirmation(order);
  }

  async function confirmOrderCancellation() {
    if (!cancelOrderConfirmation) return;
    const order = cancelOrderConfirmation;
    setCancelOrderConfirmation(null);
    await cancelOrder(order);
  }

  async function cancelOrder(order: CustomerOrder) {
    const ownerId = currentUser?.uid ?? (demoMode === "customer" ? "demo-customer" : null);
    if (!ownerId || order.userId !== ownerId) return;
    if (!canCancelOrder(order, Date.now())) {
      setNotice("Orders can only be cancelled within two hours of placing them.");
      return;
    }
    setCancelingOrderId(order.id);
    try {
      if (demoMode === "customer") {
        const cancelledAt = Date.now();
        const nextOrders = orders.map((item) => item.id === order.id ? { ...item, status: "cancelled" as const, cancelledAt } : item);
        setOrders(nextOrders);
        localStorage.setItem("ckb-demo-orders", JSON.stringify(nextOrders));
      } else if (db && currentUser) {
        await updateDoc(doc(db, "orders", order.id), { status: "cancelled", cancelledAt: serverTimestamp() });
      } else {
        return;
      }
      setNotice("Your order has been cancelled.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We couldn’t cancel that order. Please try again.");
    } finally {
      setCancelingOrderId(null);
    }
  }

  async function logout() {
    if (auth && currentUser) await signOut(auth);
    setCurrentUser(null);
    setDemoMode(null);
    setAdmin(false);
    setActiveTab("shop");
    setLogoutConfirmationOpen(false);
    setNotice("You're signed out.");
  }

  function requestLogout() {
    setLogoutConfirmationOpen(true);
  }

  function enterDemo(role: "customer" | "admin") {
    setDemoMode(role);
    setAdmin(role === "admin");
    setCurrentUser(null);
    setProfile(role === "customer"
      ? { firstName: "Alex", middleName: "", lastName: "Customer", suffix: "", address: "San Juan, Metro Manila", phone: "+639171234567", email: "alex@example.com" }
      : { firstName: "CKB", middleName: "", lastName: "Staff", suffix: "", address: "", phone: "", email: "" });
    const demoProducts = JSON.parse(localStorage.getItem("ckb-demo-products") || "[]") as Product[];
    const currentProducts = demoProducts.filter((product) => !retiredSampleProductIds.has(product.id));
    setProducts(currentProducts);
    localStorage.setItem("ckb-demo-products", JSON.stringify(currentProducts));
    setOrders(JSON.parse(localStorage.getItem("ckb-demo-orders") || "[]"));
    setActiveTab(role === "admin" ? "admin" : "shop");
    setNotice(`${role === "admin" ? "Staff" : "Customer"} preview opened. Changes are saved on this device only.`);
  }

  function openProductForm(product?: Product) {
    const item = product ?? { id: "", name: "", description: "", price: 0, saleType: "regular" as const, imageUrl: "", active: true };
    setEditingProduct(product ?? null);
    setProductDraft({ ...item });
    setImageFile(null);
  }

  function requestOrder(product: Product) {
    if (!signedIn) {
      setOrderProduct(null);
      showSignIn("login");
      return;
    }
    setOrderProduct(product);
    setOrderQuantity(1);
    setPickupDate("");
    setPickupTime("");
  }

  function requestOrders() {
    if (!signedIn) {
      setPostAuthTab("orders");
      showSignIn("login");
      return;
    }
    setActiveTab("orders");
  }

  const deliveredOrders = orders
    .filter((order) => order.status === "delivered")
    .sort((left, right) => (right.deliveredAt ?? right.createdAt) - (left.deliveredAt ?? left.createdAt));
  const filteredOrders = orders.filter((order) => order.status !== "delivered" && (dateFilter === "all" || (dateFilter === "pending" ? order.status === "pending" : orderBalance(order) > 0)));
  const canManage = Boolean(admin && (currentUser || demoMode));
  const signedIn = Boolean(currentUser || demoMode);
  const orderOwnerId = currentUser?.uid ?? (demoMode === "customer" ? "demo-customer" : null);
  const myOrders = orderOwnerId ? orders.filter((order) => order.userId === orderOwnerId) : [];
  const todayKey = localDateKey(new Date());
  const todayTotalSold = orders.reduce((total, order) => {
    if (order.status !== "delivered") return total;
    const deliveredDate = order.deliveredAt ? manilaDateKey(new Date(order.deliveredAt)) : order.pickupDate;
    return deliveredDate === today ? total + order.total : total;
  }, 0);
  const menuProducts = products.filter((product) => !today || !isPromoExpired(product, today));
  const [calendarYear, calendarMonthNumber] = calendarMonth.split("-").map(Number);
  const calendarMonthDate = calendarMonth ? new Date(calendarYear, calendarMonthNumber - 1, 1) : null;
  const calendarOffset = calendarMonthDate ? calendarMonthDate.getDay() : 0;
  const calendarDays = calendarMonthDate
    ? Array.from({ length: new Date(calendarYear, calendarMonthNumber, 0).getDate() }, (_, index) => index + 1)
    : [];
  const calendarOrders = orders.filter((order) => order.status !== "cancelled");
  const ordersByPickupDate = calendarOrders.reduce<Record<string, CustomerOrder[]>>((groupedOrders, order) => {
    (groupedOrders[order.pickupDate] ??= []).push(order);
    return groupedOrders;
  }, {});
  const selectedDateOrders = ordersByPickupDate[selectedPickupDate] ?? [];

  function changeCalendarMonth(offset: number) {
    if (!calendarMonthDate) return;
    const nextMonth = new Date(calendarYear, calendarMonthNumber - 1 + offset, 1);
    setCalendarMonth(localMonthKey(nextMonth));
    setSelectedPickupDate(localDateKey(nextMonth));
  }

  function selectTodayInCalendar() {
    const now = new Date();
    setCalendarMonth(localMonthKey(now));
    setSelectedPickupDate(localDateKey(now));
  }

  function renderAdminOrder(order: CustomerOrder) {
    return <article className="admin-order" key={order.id}><div className="admin-customer"><div><strong>{order.customer}</strong><span>{order.address}</span><a href={`tel:${order.phone}`}>{order.phone}</a></div></div><div className="admin-order-item"><div className="admin-order-photo" style={{ backgroundImage: `url("${order.imageUrl}")` }} /><div><strong>{order.productName}</strong><span>{order.quantity} × {peso(order.total)}</span></div></div><div className="admin-pickup"><span>PICKUP</span><strong>{formatDate(order.pickupDate)}</strong><span>{formatTime(order.pickupTime)}</span></div><label className="admin-downpayment"><span>DOWNPAYMENT</span><span className="downpayment-input">₱<input type="number" min="0" max={order.total} step="0.01" defaultValue={order.downpayment ?? 0} key={`${order.id}-${order.downpayment ?? 0}`} aria-label={`Downpayment for ${order.customer}`} onBlur={(event) => saveDownpayment(order, event.currentTarget)} /></span></label><div className="admin-balance"><span>BALANCE</span><strong>{peso(orderBalance(order))}</strong>{order.paymentStatus === "paid" ? <button className="payment-toggle paid" onClick={() => updateOrder(order.id, { paymentStatus: "due" })}>Fully paid</button> : orderBalance(order) === 0 ? <span className="payment-toggle paid">Fully paid</span> : <button className="payment-toggle" onClick={() => updateOrder(order.id, { paymentStatus: "paid" })}>Needs payment</button>}</div>{order.status === "cancelled" ? <button className="delivered-toggle cancelled" disabled>Cancelled</button> : <button className={order.status === "delivered" ? "delivered-toggle delivered" : "delivered-toggle"} onClick={() => updateOrder(order.id, order.status === "delivered" ? { status: "pending" } : { status: "delivered", deliveredAt: Date.now() })}>{order.status === "delivered" ? <><Check size={15} /> Delivered</> : "Mark delivered"}</button>}</article>;
  }

  return (
    <main className="app-shell">
      {!firebaseEnabled && <div className="demo-ribbon"><Sparkles size={13} /> Preview mode · connect Firebase for live ordering</div>}
      {firebaseEnabled && demoMode && <div className="demo-ribbon"><Sparkles size={13} /> Local {demoMode} preview · changes stay on this device</div>}

      <header className="topbar">
        <button className="brand-lockup" onClick={() => setActiveTab("shop")} aria-label="CKB Lechon home">
          <span className="brand-stamp brand-icon" aria-hidden="true" />
          <span className="brand-words"><strong>CKB Lechon</strong><small>CK Bless Lechon House</small></span>
        </button>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button className={activeTab === "shop" ? "nav-link active" : "nav-link"} onClick={() => setActiveTab("shop")}>Menu</button>
          {signedIn && !canManage && <button className={activeTab === "orders" ? "nav-link active" : "nav-link"} onClick={requestOrders}>My Orders</button>}
          {canManage && <button className={activeTab === "admin" ? "nav-link active" : "nav-link"} onClick={() => setActiveTab("admin")}>Order List</button>}
        </nav>
        <div className="topbar-actions">
          {!signedIn ? <button className="sign-in-button" onClick={() => showSignIn("login")}>Sign in <ArrowRight size={16} /></button> : <>
            <div className="profile-chip"><span className="profile-dot"><UserRound size={15} aria-hidden="true" /></span><span>{profile.firstName || "Account"}</span></div>
            <button className="mobile-menu" onClick={() => canManage ? setActiveTab("admin") : requestOrders()} aria-label={canManage ? "Order List" : "My Orders"} aria-current={activeTab === (canManage ? "admin" : "orders") ? "page" : undefined}>{canManage ? <List size={19} /> : <ShoppingBag size={19} />}</button>
            <button className="logout-button" onClick={requestLogout} aria-label="Log out" title="Log out"><LogOut size={16} /><span>Log out</span></button>
          </>}
        </div>
      </header>

      {activeTab === "shop" && <>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> THE TABLE IS WAITING</div>
            <h1 id="hero-title">Big days deserve<br /><em>golden lechon.</em></h1>
            <p>Slow-roasted, proudly Filipino, and always worth gathering for.</p>
            <button className="hero-cta" onClick={() => document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" })}>Find your feast <ArrowDownRight size={17} /></button>
          </div>
          <div className="hero-photo" role="img" aria-label="A generous spread of grilled Filipino feast food">
            <div className="hero-note"><span>Made for</span><strong>the whole<br />barkada.</strong><Sparkles size={17} /></div>
          </div>
          <div className="hero-side-note"><span>01 / 03</span><span className="side-line" /><span>ROASTED WITH HEART</span></div>
          <div className="hero-sun" aria-hidden="true">CKB</div>
        </section>

        <section className="menu-section" id="menu">
          <div className="section-heading">
            <div><span className="eyebrow"><span className="eyebrow-line" /> THE GOOD STUFF</span><h2>Gather round.</h2></div>
            <p>Fresh from our kitchen,<br />ready for your home.</p>
          </div>
          <div className="product-grid">
            {menuProducts.length === 0 && <div className="empty-menu">Our kitchen is adding something special. Check back soon.</div>}
            {menuProducts.map((product, index) => {
              const isPromo = product.saleType === "promo" && (!product.promoFrom || today >= product.promoFrom) && (!product.promoTo || today <= product.promoTo);
              return <article className={`product-card product-card-${index % 3}`} key={product.id}>
                <div className="product-image" style={{ backgroundImage: `url("${product.imageUrl}")` }}>
                  <span className={isPromo ? "product-tag promo-tag" : "product-tag"}>{isPromo ? <><Flame size={12} /> SPECIAL</> : "HOUSE FAVORITE"}</span>
                  <button className="product-heart" title="Order this item" onClick={() => requestOrder(product)}><ArrowUpRightIcon /></button>
                </div>
                <div className="product-info">
                  <div className="product-title-line"><h3>{product.name}</h3><span>{peso(product.price)}</span></div>
                  <p>{product.description}</p>
                  {isPromo && product.promoTo && <small className="promo-date">Promo through {formatDate(product.promoTo)}</small>}
                  <button className="order-button" onClick={() => requestOrder(product)}>Order this <ArrowRight size={15} /></button>
                </div>
              </article>;
            })}
          </div>
        </section>

      </>}

      {activeTab === "orders" && signedIn && !canManage && <section className="dashboard-section">
        <div className="dashboard-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> YOUR CKB TABLE</span><h1>My orders<span className="heading-period">.</span></h1><p>Every good gathering starts with a plan.</p></div><button className="back-menu" onClick={() => setActiveTab("shop")}><ArrowLeft size={16} /> Back to menu</button></div>
        {myOrders.length === 0 ? <div className="empty-state"><span className="empty-icon"><ShoppingBag /></span><h2>Your table is still open.</h2><p>Once you place an order, we’ll keep all the pickup details here.</p><button className="hero-cta" onClick={() => setActiveTab("shop")}>Browse the menu <ArrowRight size={16} /></button></div> : <div className="customer-order-list">{myOrders.map((order) => <article className="customer-order" key={order.id}><div className="order-thumb" style={{ backgroundImage: `url("${order.imageUrl}")` }} /><div className="customer-order-copy"><div className="customer-order-top"><h2>{order.productName}</h2></div><p>{order.quantity} {order.quantity === 1 ? "item" : "items"} · {peso(order.total)}</p><div className="pickup-line"><CalendarDays size={15} />{formatDate(order.pickupDate)} <span>·</span><Clock3 size={15} />{formatTime(order.pickupTime)}</div></div><div className="customer-order-actions"><div className="payment-note">{order.status === "delivered" ? <><Check size={16} /> Delivered</> : orderBalance(order) === 0 ? <><BadgeCheck size={16} /> Fully paid</> : <>Balance due <strong>{peso(orderBalance(order))}</strong></>}</div><button className="downpayment-qr-button" onClick={() => setDownpaymentQrOpen(true)}>Downpayment QR</button>{canCancelOrder(order, currentTime) && <button className="cancel-order-button" onClick={() => requestOrderCancellation(order)} disabled={cancelingOrderId === order.id}>{cancelingOrderId === order.id ? "Cancelling..." : "Cancel Order"}</button>}</div></article>)}</div>}
      </section>}

      {activeTab === "admin" && canManage && <section className="dashboard-section admin-section">
        <div className="dashboard-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> CKB LECHON HOUSE</span><h1>Pickup calendar<span className="heading-period">.</span></h1><p>Choose a pickup date to see its orders.</p></div><button className="add-menu-button" onClick={() => openProductForm()}><Plus size={16} /> Add menu item</button></div>
        <div className="admin-calendar-layout">
          <section className="admin-calendar-card" aria-labelledby="pickup-calendar-heading">
            <div className="admin-calendar-toolbar">
              <button className="calendar-nav-button" onClick={() => changeCalendarMonth(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button>
              <h2 id="pickup-calendar-heading">{calendarMonthDate?.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</h2>
              <button className="calendar-nav-button" onClick={() => changeCalendarMonth(1)} aria-label="Next month"><ChevronRight size={17} /></button>
              <button className="calendar-today-button" onClick={selectTodayInCalendar}>Today</button>
            </div>
            <div className="admin-calendar-weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
            <div className="admin-calendar-days">
              {Array.from({ length: calendarOffset }, (_, index) => <span className="admin-calendar-empty-day" key={`empty-${index}`} />)}
              {calendarDays.map((day) => {
                const dateKey = localDateKey(new Date(calendarYear, calendarMonthNumber - 1, day));
                const dayOrderCount = ordersByPickupDate[dateKey]?.length ?? 0;
                return <button className={`admin-calendar-day${dateKey === selectedPickupDate ? " selected" : ""}${dateKey === todayKey ? " today" : ""}${dayOrderCount ? " has-orders" : ""}`} key={dateKey} onClick={() => setSelectedPickupDate(dateKey)} aria-pressed={dateKey === selectedPickupDate} aria-label={`${formatCalendarDate(dateKey, { weekday: "long", month: "long", day: "numeric" })}, ${dayOrderCount} ${dayOrderCount === 1 ? "order" : "orders"}`}><span>{day}</span>{dayOrderCount > 0 && <span className="admin-calendar-count">{dayOrderCount}</span>}</button>;
              })}
            </div>
          </section>
          <section className="admin-selected-date" aria-live="polite" aria-labelledby="selected-date-heading">
            <div className="selected-date-heading"><div><span className="eyebrow">SELECTED DATE</span><h2 id="selected-date-heading">{selectedPickupDate ? formatCalendarDate(selectedPickupDate, { month: "long", day: "numeric", year: "numeric" }) : "Choose a date"}</h2></div><span className="selected-date-count">{selectedDateOrders.length} {selectedDateOrders.length === 1 ? "order" : "orders"}</span></div>
            {selectedDateOrders.length === 0 ? <div className="calendar-empty-state">No orders scheduled for this date.</div> : <div className="calendar-orders-table-wrap"><table className="calendar-orders-table"><thead><tr><th>Name</th><th>Order</th><th>Balance</th><th>Contact No.</th></tr></thead><tbody>{selectedDateOrders.map((order) => <tr key={order.id}><td>{order.customer}</td><td>{order.quantity} {order.quantity === 1 ? "item" : "items"} · {order.productName}</td><td><span className={orderBalance(order) === 0 ? "calendar-balance paid" : "calendar-balance"}>{orderBalance(order) === 0 ? "Paid" : peso(orderBalance(order))}</span></td><td><a href={`tel:${order.phone}`}>{order.phone}</a></td></tr>)}</tbody></table></div>}
          </section>
        </div>
        <div className="admin-metrics"><div><span>ALL ORDERS</span><strong>{orders.length.toString().padStart(2, "0")}</strong><PackageCheck size={17} /></div><div><span>NEEDS PAYMENT</span><strong>{orders.filter((item) => item.status !== "cancelled" && orderBalance(item) > 0).length.toString().padStart(2, "0")}</strong><CircleHelp size={17} /></div><div><span>READY TO PICK UP</span><strong>{orders.filter((item) => item.status === "pending").length.toString().padStart(2, "0")}</strong><Clock3 size={17} /></div><div><span>TODAY TOTAL SOLD</span><strong>{peso(todayTotalSold)}</strong><Banknote size={17} /></div></div>
        <div className="order-list-heading"><div><h2>The pickup list</h2><span>Customer orders, all in one place.</span></div><select aria-label="Filter orders" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">All orders</option><option value="pending">Not yet delivered</option><option value="due">Needs full payment</option></select></div>
        {filteredOrders.length === 0 ? <div className="admin-empty">No pickup orders match this filter.</div> : <div className="admin-order-list">{filteredOrders.map(renderAdminOrder)}</div>}
        <div className="order-list-heading delivered-orders-heading"><div><h2>Delivered Orders</h2><span>Orders handed over to customers.</span></div></div>
        {deliveredOrders.length === 0 ? <div className="admin-empty">No delivered orders just yet.</div> : <div className="admin-order-list">{deliveredOrders.map(renderAdminOrder)}</div>}
        <div className="admin-products-heading"><div><h2>Menu items</h2><span>Manage what customers can order.</span></div></div>
        <div className="admin-products-list">{products.map((product) => <article key={product.id}><div className="admin-product-photo" style={{ backgroundImage: `url("${product.imageUrl}")` }} /><div className="admin-product-copy"><strong>{product.name}</strong><span>{peso(product.price)} · {product.saleType === "promo" ? `Promo${product.promoFrom ? ` from ${formatDate(product.promoFrom)}` : ""}` : "Regular"}</span></div><button className="edit-product" onClick={() => openProductForm(product)}>Edit</button><button className="remove-product" onClick={() => archiveProduct(product)}>Remove</button></article>)}</div>
      </section>}

      {activeTab !== "orders" && <footer className="site-footer"><div className="footer-brand"><span className="brand-stamp brand-icon" aria-hidden="true" /><div><strong>CK Bless Lechon House</strong><span>Located at Purok-11, Obrero, Butuan City 8600</span></div></div><div className="footer-socials"><a className="social-link" href="https://www.facebook.com/LeAndrei.Yang7" target="_blank" rel="noreferrer" aria-label="Facebook"><Facebook size={17} /></a><button className="social-link" onClick={() => setLocationMapOpen(true)} aria-label="Open location map" title="View location"><MapPin size={17} /></button></div></footer>}

      {demoMode && <div className="demo-role-switch"><span>PREVIEW AS</span><button className={demoMode === "customer" ? "selected" : ""} onClick={() => enterDemo("customer")}>Customer</button><button className={demoMode === "admin" ? "selected" : ""} onClick={() => enterDemo("admin")}>Staff</button><button onClick={requestLogout} title="Exit preview"><X size={15} /></button></div>}

      {notice && <div className="toast" role="status"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}

      {authOpen && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
          <section className="dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="dialog-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={19} /></button>
            <div className="dialog-kicker">CKB LECHON HOUSE</div>
            <h2 id="auth-title">{authMode === "signup" ? "Come on in." : "Welcome back."}</h2>
            <p>{authMode === "signup" ? "Create your account and we’ll save a place at the table." : "Sign in to schedule your next feast."}</p>
            {!firebaseEnabled ? (
              <div className="auth-preview">
                <span><Sparkles size={19} /></span>
                <strong>Firebase is not connected yet.</strong>
                <p>Use a local preview account to explore customer and staff screens.</p>
                <button className="submit-button" onClick={() => { setAuthOpen(false); enterDemo("customer"); }}>Continue as customer <ArrowRight size={16} /></button>
                <button className="preview-staff-link" onClick={() => { setAuthOpen(false); enterDemo("admin"); }}>Open staff preview <ArrowRight size={14} /></button>
                <div className="preview-divider">OR CONNECT YOUR ACCOUNT</div>
                <button className="text-button" onClick={() => setAuthMode(authMode === "signup" ? "login" : "signup")}>{authMode === "signup" ? "Already have an account? Sign in" : "New to CKB? Create an account"}</button>
              </div>
            ) : authMode === "login" ? (
              <form className="auth-form" onSubmit={signIn}>
                <label>Email<input required type="email" autoComplete="email" placeholder="you@example.com" value={authProfile.email} onChange={(event) => setAuthProfile({ ...authProfile, email: event.target.value })} /></label>
                <div className="password-form-field"><label htmlFor="auth-password">Password</label><div className="password-field"><input id="auth-password" required type={showAuthPassword ? "text" : "password"} autoComplete="current-password" placeholder="Your password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /><button type="button" className="password-toggle" onClick={() => setShowAuthPassword(!showAuthPassword)} aria-label={showAuthPassword ? "Hide password" : "Show password"} aria-pressed={showAuthPassword}>{showAuthPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
                {authError && <div className="form-error">{authError}</div>}
                <button className="submit-button" disabled={busy}>{busy ? "Signing in..." : "Sign in"}<ArrowRight size={16} /></button>
                <button type="button" className="text-button" onClick={() => showSignIn("signup")}>New to CKB? Create an account</button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={register}>
                <div className="name-fields">
                  <label>First name<input required autoComplete="given-name" value={authProfile.firstName} onChange={(event) => setAuthProfile({ ...authProfile, firstName: event.target.value })} /></label>
                  <label>Middle name<input autoComplete="additional-name" value={authProfile.middleName} onChange={(event) => setAuthProfile({ ...authProfile, middleName: event.target.value })} /></label>
                  <label>Last name<input required autoComplete="family-name" value={authProfile.lastName} onChange={(event) => setAuthProfile({ ...authProfile, lastName: event.target.value })} /></label>
                  <label>Suffix<input placeholder="Jr., III" value={authProfile.suffix} onChange={(event) => setAuthProfile({ ...authProfile, suffix: event.target.value })} /></label>
                </div>
                <label>Address<input required autoComplete="street-address" value={authProfile.address} onChange={(event) => setAuthProfile({ ...authProfile, address: event.target.value })} /></label>
                <label>Contact number<input required type="tel" autoComplete="tel" placeholder="09XX XXX XXXX" value={authProfile.phone} onChange={(event) => setAuthProfile({ ...authProfile, phone: event.target.value })} /></label>
                <label>Email<input required type="email" autoComplete="email" placeholder="you@example.com" value={authProfile.email} onChange={(event) => setAuthProfile({ ...authProfile, email: event.target.value })} /></label>
                <div className="name-fields">
                  <div className="password-form-field"><label htmlFor="auth-password">Password</label><div className="password-field"><input id="auth-password" required type={showAuthPassword ? "text" : "password"} autoComplete="new-password" minLength={6} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /><button type="button" className="password-toggle" onClick={() => setShowAuthPassword(!showAuthPassword)} aria-label={showAuthPassword ? "Hide password" : "Show password"} aria-pressed={showAuthPassword}>{showAuthPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
                  <div className="password-form-field"><label htmlFor="confirm-password">Confirm password</label><div className="password-field"><input id="confirm-password" required type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><button type="button" className="password-toggle" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
                </div>
                {authError && <div className="form-error">{authError}</div>}
                <button className="submit-button" disabled={busy}>{busy ? "Creating account..." : "Create account"}<ArrowRight size={16} /></button>
                <button type="button" className="text-button" onClick={() => showSignIn("login")}>Already have an account? Sign in</button>
              </form>
            )}
          </section>
        </div>
      )}

      {downpaymentQrOpen && <div className="overlay qr-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDownpaymentQrOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setDownpaymentQrOpen(false); }}><section className="dialog qr-dialog" role="dialog" aria-modal="true" aria-labelledby="downpayment-qr-title" aria-describedby="downpayment-qr-description"><button className="dialog-close" autoFocus onClick={() => setDownpaymentQrOpen(false)} aria-label="Close QR code"><X size={19} /></button><div className="dialog-kicker">DOWNPAYMENT</div><h2 id="downpayment-qr-title">Scan to pay.</h2><p id="downpayment-qr-description">Scan this QR code with your banking or payment app.</p><Image className="downpayment-qr-image" src="/downpayment-qr.jpg" alt="Downpayment QR code" width={1284} height={1930} priority /><a className="submit-button qr-save-button" href="/downpayment-qr.jpg" download="downpayment-qr.jpg"><span>Save this QR</span><Download size={17} /></a></section></div>}

      {locationMapOpen && <div className="overlay map-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLocationMapOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setLocationMapOpen(false); }}><section className="dialog map-dialog" role="dialog" aria-modal="true" aria-labelledby="location-map-title" aria-describedby="location-map-description"><button className="dialog-close" autoFocus onClick={() => setLocationMapOpen(false)} aria-label="Close location map"><X size={19} /></button><div className="dialog-kicker">CKB LECHON HOUSE</div><h2 id="location-map-title">Find us.</h2><p id="location-map-description">Located at Purok-11, Obrero, Butuan City 8600.</p><iframe className="location-map-frame" title="Map to CKB Lechon House" src="https://www.google.com/maps?q=8.964564313632456%2C125.53672241133174&z=17&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /><a className="map-external-link" href="https://www.google.com/maps?q=8.964564313632456%2C125.53672241133174" target="_blank" rel="noreferrer">Open in Google Maps <ArrowRight size={14} /></a></section></div>}

      {cancelOrderConfirmation && <div className="overlay confirmation-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCancelOrderConfirmation(null); }} onKeyDown={(event) => { if (event.key === "Escape") setCancelOrderConfirmation(null); }}><section className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-order-title" aria-describedby="cancel-order-description"><span className="confirmation-icon"><CircleAlert size={21} /></span><div className="dialog-kicker">YOUR CKB TABLE</div><h2 id="cancel-order-title">Cancel this order?</h2><p id="cancel-order-description">You’re cancelling <strong>{cancelOrderConfirmation.productName}</strong>. This can’t be undone.</p><div className="confirmation-order-summary"><span>{formatDate(cancelOrderConfirmation.pickupDate)} · {formatTime(cancelOrderConfirmation.pickupTime)}</span><strong>{peso(cancelOrderConfirmation.total)}</strong></div><div className="confirmation-actions"><button className="confirmation-keep" autoFocus onClick={() => setCancelOrderConfirmation(null)}>Keep order</button><button className="confirmation-cancel" onClick={confirmOrderCancellation} disabled={cancelingOrderId === cancelOrderConfirmation.id}>{cancelingOrderId === cancelOrderConfirmation.id ? "Cancelling…" : "Cancel order"}</button></div></section></div>}

      {logoutConfirmationOpen && <div className="overlay confirmation-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogoutConfirmationOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setLogoutConfirmationOpen(false); }}><section className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description"><span className="confirmation-icon"><LogOut size={20} /></span><div className="dialog-kicker">CKB LECHON HOUSE</div><h2 id="logout-title">Logout Confirmation</h2><p id="logout-description">Are you sure you want to end your session?</p><div className="confirmation-actions"><button className="confirmation-keep" autoFocus onClick={() => setLogoutConfirmationOpen(false)}>Stay signed in</button><button className="confirmation-cancel" onClick={logout}>Log out</button></div></section></div>}

      {orderProduct && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrderProduct(null); }}><section className="dialog order-dialog" role="dialog" aria-modal="true" aria-labelledby="pickup-title"><button className="dialog-close" onClick={() => setOrderProduct(null)} aria-label="Close"><X size={19} /></button><div className="order-dialog-photo" style={{ backgroundImage: `url("${orderProduct.imageUrl}")` }} /><div className="dialog-kicker">MAKE IT A GATHERING</div><h2 id="pickup-title">Save your spot.</h2><p className="order-summary"><strong>{orderProduct.name}</strong><span>{peso(orderProduct.price * Math.max(1, orderQuantity))}</span></p><form className="auth-form" onSubmit={placeOrder}><label>Quantity<input type="number" min={1} max={99} step={1} required value={orderQuantity} onChange={(event) => setOrderQuantity(event.target.value === "" ? 0 : Number(event.target.value))} /></label><label>Pickup date<input required type="date" min={today} value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} /></label><label>Pickup time<input required type="time" min="09:00" max="18:00" step={60} value={pickupTime} onChange={(event) => setPickupTime(event.target.value)} /></label>{!signedIn && <div className="pickup-note">Sign in or try a preview to confirm your pickup.</div>}<button className="submit-button" disabled={busy}>{busy ? "Saving your pickup..." : "Confirm pickup"}<ArrowRight size={16} /></button></form></section></div>}

      {productDraft && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setProductDraft(null); setEditingProduct(null); } }}><section className="dialog product-dialog" role="dialog" aria-modal="true" aria-labelledby="product-form-title"><button className="dialog-close" onClick={() => { setProductDraft(null); setEditingProduct(null); }} aria-label="Close"><X size={19} /></button><div className="dialog-kicker">THE CKB MENU</div><h2 id="product-form-title">{editingProduct ? "Edit menu item." : "Add something good."}</h2><form className="auth-form" onSubmit={saveProduct}><label>Order name<input required value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} /></label><label>Description<textarea required rows={3} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} /></label><label>Price (₱)<input type="number" required min="0" step="0.01" value={productDraft.price || ""} onChange={(event) => setProductDraft({ ...productDraft, price: Number(event.target.value) })} /></label><label>Sale type<select value={productDraft.saleType} onChange={(event) => setProductDraft({ ...productDraft, saleType: event.target.value as Product["saleType"] })}><option value="regular">Regular</option><option value="promo">Promo</option></select></label>{productDraft.saleType === "promo" && <div className="name-fields"><label>Date from<input required type="date" value={productDraft.promoFrom || ""} onChange={(event) => setProductDraft({ ...productDraft, promoFrom: event.target.value })} /></label><label>Date to<input required type="date" value={productDraft.promoTo || ""} onChange={(event) => setProductDraft({ ...productDraft, promoTo: event.target.value })} /></label></div>}<label>Upload image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /></label>{!uploadThingConfigured && !demoMode && <div className="pickup-note">Configure the UploadThing Worker URL to enable image uploads.</div>}<button className="submit-button" disabled={busy}>{busy ? uploadingImage ? "Uploading image..." : "Saving..." : editingProduct ? "Save changes" : "Add to menu"}<ArrowRight size={16} /></button></form></section></div>}
    </main>
  );
}

function ArrowUpRightIcon() {
  return <ArrowRight size={17} strokeWidth={2.2} />;
}
