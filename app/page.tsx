"use client";

import {
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Flame,
  Instagram,
  Menu,
  PackageCheck,
  Plus,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { auth, db, firebaseEnabled, storage } from "@/lib/firebase";

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
  pickupDate: string;
  pickupTime: string;
  paymentStatus: "paid" | "due";
  status: "pending" | "delivered";
  createdAt: number;
};

type Tab = "shop" | "orders" | "admin";
type AuthMode = "login" | "signup";

const productPhotos = {
  lechon: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1000&q=85",
  belly: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=1000&q=85",
  sisig: "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=1000&q=85",
};

const starterProducts: Product[] = [
  {
    id: "whole-lechon",
    name: "Whole Lechon",
    description: "Golden, crackling skin. Tender, slow-roasted goodness made for your whole table.",
    price: 12500,
    saleType: "promo",
    promoFrom: "2026-01-01",
    promoTo: "2026-12-31",
    imageUrl: productPhotos.lechon,
    active: true,
  },
  {
    id: "lechon-belly",
    name: "Lechon Belly Roll",
    description: "All the lechon flavor, wrapped up with crispy skin and aromatic herbs.",
    price: 3200,
    saleType: "regular",
    imageUrl: productPhotos.belly,
    active: true,
  },
  {
    id: "crispy-sisig",
    name: "Lechon Sisig",
    description: "A sizzling, savory favorite with that unmistakable lechon crunch.",
    price: 480,
    saleType: "regular",
    imageUrl: productPhotos.sisig,
    active: true,
  },
];

const blankProfile: Profile = { firstName: "", middleName: "", lastName: "", suffix: "", address: "", phone: "" };
const peso = (value: number) => `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const productCollection = () => collection(db!, "products");
const orderCollection = () => collection(db!, "orders");
const profilePath = (uid: string) => doc(db!, "users", uid);

function displayName(profile: Profile) {
  return [profile.firstName, profile.middleName, profile.lastName, profile.suffix].filter(Boolean).join(" ");
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("63")) return `+${digits}`;
  if (digits.startsWith("0")) return `+63${digits.slice(1)}`;
  return `+${digits}`;
}

function loginEmail(phone: string) {
  return `phone.${normalizePhone(phone).replace(/\D/g, "")}@ckblechon.com`;
}

function formatDate(value: string) {
  if (!value) return "Choose a pickup day";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: string) {
  return new Date(`2000-01-01T${value}`).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>(starterProducts);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [profile, setProfile] = useState<Profile>(blankProfile);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState(false);
  const [demoMode, setDemoMode] = useState<"customer" | "admin" | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("shop");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [orderProduct, setOrderProduct] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authProfile, setAuthProfile] = useState<Profile>(blankProfile);
  const [authPassword, setAuthPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [productDraft, setProductDraft] = useState<Product | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const confirmation = useRef<ConfirmationResult | null>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (!firebaseEnabled || !auth || !db) return;
    return onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setDemoMode(null);
      if (!user) {
        setProfile(blankProfile);
        setAdmin(false);
        setOrders([]);
        return;
      }
      const token = await user.getIdTokenResult();
      const isStaff = token.claims.admin === true;
      setAdmin(isStaff);
      if (user.phoneNumber) setProfile((current) => ({ ...current, phone: user.phoneNumber ?? current.phone }));
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
        .filter((item) => admin || item.active)
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
    setCodeSent(false);
    setOtpCode("");
    setAuthOpen(true);
  }

  async function sendVerificationCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    if (!auth || !authProfile.phone || !authProfile.firstName || !authProfile.lastName || !authPassword || !authProfile.address) {
      setAuthError("Please complete your name, address, mobile number, and password first.");
      return;
    }
    if (authPassword.length < 6 || authPassword !== confirmPassword) {
      setAuthError("Passwords must match and have at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      verifier.current?.clear();
      verifier.current = new RecaptchaVerifier(auth, "phone-recaptcha", { size: "normal" });
      confirmation.current = await signInWithPhoneNumber(auth, normalizePhone(authProfile.phone), verifier.current);
      setCodeSent(true);
      setNotice("Verification code sent.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to send a verification code. Check the mobile number and try again.");
      verifier.current?.clear();
      verifier.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function finishSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !confirmation.current) return;
    setBusy(true);
    setAuthError("");
    try {
      const phoneUser = await confirmation.current.confirm(otpCode.trim());
      const credential = EmailAuthProvider.credential(loginEmail(authProfile.phone), authPassword);
      await linkWithCredential(phoneUser.user, credential);
      await setDoc(profilePath(phoneUser.user.uid), {
        ...authProfile,
        phone: normalizePhone(authProfile.phone),
        role: "user",
        createdAt: Date.now(),
      });
      setProfile({ ...authProfile, phone: normalizePhone(authProfile.phone) });
      setAuthOpen(false);
      setNotice("Your number is verified. Welcome to CKB Lechon!");
      confirmation.current = null;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "We couldn't verify the code. Please check it and try again.");
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
      const result = await signInWithEmailAndPassword(auth, loginEmail(authProfile.phone), authPassword);
      const data = await getDoc(profilePath(result.user.uid));
      if (data.exists()) setProfile(data.data() as Profile);
      setAuthOpen(false);
      setNotice("You're signed in. Let's find something delicious.");
    } catch (error) {
      setAuthError(error instanceof Error && error.message.includes("invalid-credential")
        ? "That mobile number and password don't match. New here? Create an account and verify your number by SMS."
        : error instanceof Error ? error.message : "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orderProduct || !pickupDate || !pickupTime) return;
    const order: Omit<CustomerOrder, "id"> = {
      userId: currentUser?.uid ?? "demo-customer",
      customer: displayName(profile) || "Alex Customer",
      address: profile.address || "San Juan, Metro Manila",
      phone: profile.phone || "+639171234567",
      productId: orderProduct.id,
      productName: orderProduct.name,
      imageUrl: orderProduct.imageUrl,
      quantity: 1,
      total: orderProduct.price,
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
      let imageUrl = productDraft.imageUrl || productPhotos.lechon;
      if (imageFile) {
        if (storage && !demoMode) {
          const imageRef = ref(storage, `products/${Date.now()}-${imageFile.name.replace(/[^\w.-]/g, "-")}`);
          await uploadBytes(imageRef, imageFile, { contentType: imageFile.type });
          imageUrl = await getDownloadURL(imageRef);
        } else {
          imageUrl = URL.createObjectURL(imageFile);
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

  async function logout() {
    if (auth && currentUser) await signOut(auth);
    setCurrentUser(null);
    setDemoMode(null);
    setAdmin(false);
    setActiveTab("shop");
    setNotice("You're signed out.");
  }

  function enterDemo(role: "customer" | "admin") {
    setDemoMode(role);
    setAdmin(role === "admin");
    setCurrentUser(null);
    setProfile(role === "customer"
      ? { firstName: "Alex", middleName: "", lastName: "Customer", suffix: "", address: "San Juan, Metro Manila", phone: "+639171234567" }
      : { firstName: "CKB", middleName: "", lastName: "Staff", suffix: "", address: "", phone: "" });
    setProducts(JSON.parse(localStorage.getItem("ckb-demo-products") || "null") || starterProducts);
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

  const filteredOrders = orders.filter((order) => dateFilter === "all" || (dateFilter === "pending" ? order.status === "pending" : order.paymentStatus === "due"));
  const canManage = Boolean(admin && (currentUser || demoMode));
  const signedIn = Boolean(currentUser || demoMode);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="app-shell">
      {!firebaseEnabled && <div className="demo-ribbon"><Sparkles size={13} /> Preview mode · connect Firebase for live ordering</div>}
      {firebaseEnabled && demoMode && <div className="demo-ribbon"><Sparkles size={13} /> Local {demoMode} preview · changes stay on this device</div>}

      <header className="topbar">
        <button className="brand-lockup" onClick={() => setActiveTab("shop")} aria-label="CKB Lechon home">
          <span className="brand-stamp">CK<span>B</span></span>
          <span className="brand-words"><strong>CKB Lechon</strong><small>CK Bless Lechon House</small></span>
        </button>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button className={activeTab === "shop" ? "nav-link active" : "nav-link"} onClick={() => setActiveTab("shop")}>Order <span>01</span></button>
          {signedIn && <button className={activeTab === "orders" ? "nav-link active" : "nav-link"} onClick={() => setActiveTab("orders")}>My order <span>{orders.length.toString().padStart(2, "0")}</span></button>}
          {canManage && <button className={activeTab === "admin" ? "nav-link active" : "nav-link"} onClick={() => setActiveTab("admin")}>Order list <span>•</span></button>}
        </nav>
        <div className="topbar-actions">
          {!signedIn ? <button className="sign-in-button" onClick={() => showSignIn("login")}>Sign in <ArrowRight size={16} /></button> : <button className="profile-chip" onClick={logout}><span className="profile-dot">{(profile.firstName || "C").slice(0, 1)}</span><span>{profile.firstName || "Account"}</span><ChevronDown size={14} /></button>}
          <button className="mobile-menu" onClick={() => setActiveTab(activeTab === "shop" ? "orders" : "shop")} aria-label="Switch view"><Menu size={19} /></button>
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
            <p>Fresh from our kitchen,<br />ready for your table.</p>
          </div>
          <div className="product-grid">
            {products.length === 0 && <div className="empty-menu">Our kitchen is adding something special. Check back soon.</div>}
            {products.map((product, index) => {
              const isPromo = product.saleType === "promo" && (!product.promoFrom || today >= product.promoFrom) && (!product.promoTo || today <= product.promoTo);
              return <article className={`product-card product-card-${index % 3}`} key={product.id}>
                <div className="product-image" style={{ backgroundImage: `url("${product.imageUrl || productPhotos.lechon}")` }}>
                  <span className={isPromo ? "product-tag promo-tag" : "product-tag"}>{isPromo ? <><Flame size={12} /> SPECIAL</> : "HOUSE FAVORITE"}</span>
                  <button className="product-heart" title="Order this item" onClick={() => { setOrderProduct(product); if (!signedIn) showSignIn("login"); }}><ArrowUpRightIcon /></button>
                </div>
                <div className="product-info">
                  <div className="product-title-line"><h3>{product.name}</h3><span>{peso(product.price)}</span></div>
                  <p>{product.description}</p>
                  {isPromo && product.promoTo && <small className="promo-date">Promo through {formatDate(product.promoTo)}</small>}
                  <button className="order-button" onClick={() => { setOrderProduct(product); setPickupDate(""); setPickupTime(""); }}>Order this <ArrowRight size={15} /></button>
                </div>
              </article>;
            })}
          </div>
        </section>

        <section className="gathering-strip">
          <div className="strip-mark"><Flame size={20} /></div><div><span>GOOD FOOD, GOOD COMPANY</span><strong>Make room at the table.</strong></div><button onClick={() => document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" })}>Explore menu <ArrowRight size={16} /></button>
        </section>
      </>}

      {activeTab === "orders" && <section className="dashboard-section">
        <div className="dashboard-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> YOUR CKB TABLE</span><h1>My orders<span className="heading-period">.</span></h1><p>Every good gathering starts with a plan.</p></div><button className="back-menu" onClick={() => setActiveTab("shop")}><ArrowLeft size={16} /> Back to menu</button></div>
        {orders.length === 0 ? <div className="empty-state"><span className="empty-icon"><ShoppingBag /></span><h2>Your table is still open.</h2><p>Once you place an order, we’ll keep all the pickup details here.</p><button className="hero-cta" onClick={() => setActiveTab("shop")}>Browse the menu <ArrowRight size={16} /></button></div> : <div className="customer-order-list">{orders.map((order) => <article className="customer-order" key={order.id}><div className="order-thumb" style={{ backgroundImage: `url("${order.imageUrl}")` }} /><div className="customer-order-copy"><div className="customer-order-top"><h2>{order.productName}</h2><span className={`status-pill ${order.status === "delivered" ? "status-done" : "status-pending"}`}>{order.status === "delivered" ? "Delivered" : "Preparing"}</span></div><p>{order.quantity} item · {peso(order.total)}</p><div className="pickup-line"><CalendarDays size={15} />{formatDate(order.pickupDate)} <span>·</span><Clock3 size={15} />{formatTime(order.pickupTime)}</div></div><div className="payment-note">{order.paymentStatus === "paid" ? <><BadgeCheck size={16} /> Fully paid</> : <>Balance due <strong>{peso(order.total)}</strong></>}</div></article>)}</div>}
      </section>}

      {activeTab === "admin" && canManage && <section className="dashboard-section admin-section">
        <div className="dashboard-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> CKB LECHON HOUSE</span><h1>Order desk<span className="heading-period">.</span></h1><p>Every detail, from kitchen to pickup.</p></div><button className="add-menu-button" onClick={() => openProductForm()}><Plus size={16} /> Add menu item</button></div>
        <div className="admin-metrics"><div><span>ALL ORDERS</span><strong>{orders.length.toString().padStart(2, "0")}</strong><PackageCheck size={17} /></div><div><span>NEEDS PAYMENT</span><strong>{orders.filter((item) => item.paymentStatus === "due").length.toString().padStart(2, "0")}</strong><CircleHelp size={17} /></div><div><span>READY TO PICK UP</span><strong>{orders.filter((item) => item.status === "pending").length.toString().padStart(2, "0")}</strong><Clock3 size={17} /></div></div>
        <div className="order-list-heading"><div><h2>The pickup list</h2><span>Customer orders, all in one place.</span></div><select aria-label="Filter orders" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">All orders</option><option value="pending">Not yet delivered</option><option value="due">Needs full payment</option></select></div>
        {filteredOrders.length === 0 ? <div className="admin-empty">No orders just yet. When a customer books a pickup, it’ll show up here.</div> : <div className="admin-order-list">{filteredOrders.map((order) => <article className="admin-order" key={order.id}><div className="admin-customer"><span className="avatar-small">{(order.customer || "C").slice(0, 1)}</span><div><strong>{order.customer}</strong><span>{order.address}</span><a href={`tel:${order.phone}`}>{order.phone}</a></div></div><div className="admin-order-item"><div className="admin-order-photo" style={{ backgroundImage: `url("${order.imageUrl}")` }} /><div><strong>{order.productName}</strong><span>{order.quantity} × {peso(order.total)}</span></div></div><div className="admin-pickup"><span>PICKUP</span><strong>{formatDate(order.pickupDate)}</strong><span>{formatTime(order.pickupTime)}</span></div><div className="admin-balance"><span>BALANCE</span><strong>{order.paymentStatus === "paid" ? "₱0" : peso(order.total)}</strong><button className={order.paymentStatus === "paid" ? "payment-toggle paid" : "payment-toggle"} onClick={() => updateOrder(order.id, { paymentStatus: order.paymentStatus === "paid" ? "due" : "paid" })}>{order.paymentStatus === "paid" ? "Fully paid" : "Needs payment"}</button></div><button className={order.status === "delivered" ? "delivered-toggle delivered" : "delivered-toggle"} onClick={() => updateOrder(order.id, { status: order.status === "delivered" ? "pending" : "delivered" })}>{order.status === "delivered" ? <><Check size={15} /> Delivered</> : "Mark delivered"}</button></article>)}</div>}
        <div className="admin-products-heading"><div><h2>Menu items</h2><span>Manage what customers can order.</span></div></div>
        <div className="admin-products-list">{products.map((product) => <article key={product.id}><div className="admin-product-photo" style={{ backgroundImage: `url("${product.imageUrl}")` }} /><div className="admin-product-copy"><strong>{product.name}</strong><span>{peso(product.price)} · {product.saleType === "promo" ? `Promo${product.promoFrom ? ` from ${formatDate(product.promoFrom)}` : ""}` : "Regular"}</span></div><button className="edit-product" onClick={() => openProductForm(product)}>Edit</button><button className="remove-product" onClick={() => archiveProduct(product)}>Remove</button></article>)}</div>
      </section>}

      <footer className="site-footer"><div className="footer-brand"><span className="brand-stamp">CK<span>B</span></span><div><strong>CK Bless Lechon House</strong><span>Made for your kind of gathering.</span></div></div><div className="footer-note">MADE WITH HEART, SERVED WITH PRIDE <span>© 2026 CKB LECHON</span></div><a className="social-link" href="https://www.instagram.com/" target="_blank" rel="noreferrer" aria-label="Instagram"><Instagram size={17} /></a></footer>

      {demoMode && <div className="demo-role-switch"><span>PREVIEW AS</span><button className={demoMode === "customer" ? "selected" : ""} onClick={() => enterDemo("customer")}>Customer</button><button className={demoMode === "admin" ? "selected" : ""} onClick={() => enterDemo("admin")}>Staff</button><button onClick={logout} title="Exit preview"><X size={15} /></button></div>}

      {notice && <div className="toast" role="status"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}

      {authOpen && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setAuthOpen(false); verifier.current?.clear(); verifier.current = null; } }}><section className="dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="dialog-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={19} /></button><div className="dialog-kicker">CKB LECHON HOUSE</div><h2 id="auth-title">{authMode === "signup" ? "Come on in." : "Welcome back."}</h2><p>{authMode === "signup" ? "Create your account and we’ll save a place at the table." : "Sign in to schedule your next feast."}</p>
        {!firebaseEnabled ? <div className="auth-preview"><span><Sparkles size={19} /></span><strong>Firebase is not connected yet.</strong><p>Use a local preview account to explore customer and staff screens.</p><button className="submit-button" onClick={() => { setAuthOpen(false); enterDemo("customer"); }}>Continue as customer <ArrowRight size={16} /></button><button className="preview-staff-link" onClick={() => { setAuthOpen(false); enterDemo("admin"); }}>Open staff preview <ArrowRight size={14} /></button><div className="preview-divider">OR CONNECT YOUR ACCOUNT</div><button className="text-button" onClick={() => setAuthMode(authMode === "signup" ? "login" : "signup")}>{authMode === "signup" ? "Already have an account? Sign in" : "New to CKB? Create an account"}</button></div> : <>
          {authMode === "login" ? <form className="auth-form" onSubmit={signIn}><label>Mobile number<input required type="tel" autoComplete="tel" placeholder="09XX XXX XXXX" value={authProfile.phone} onChange={(event) => setAuthProfile({ ...authProfile, phone: event.target.value })} /></label><label>Password<input required type="password" autoComplete="current-password" placeholder="Your password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /></label>{authError && <div className="form-error">{authError}</div>}<button className="submit-button" disabled={busy}>{busy ? "Signing in..." : "Sign in"}<ArrowRight size={16} /></button><button type="button" className="text-button" onClick={() => showSignIn("signup")}>New to CKB? Create an account</button></form> : <form className="auth-form" onSubmit={codeSent ? finishSignup : sendVerificationCode}>
            {!codeSent ? <><div className="name-fields"><label>First name<input required value={authProfile.firstName} onChange={(event) => setAuthProfile({ ...authProfile, firstName: event.target.value })} /></label><label>Middle name<input value={authProfile.middleName} onChange={(event) => setAuthProfile({ ...authProfile, middleName: event.target.value })} /></label><label>Last name<input required value={authProfile.lastName} onChange={(event) => setAuthProfile({ ...authProfile, lastName: event.target.value })} /></label><label>Suffix<input placeholder="Jr., III" value={authProfile.suffix} onChange={(event) => setAuthProfile({ ...authProfile, suffix: event.target.value })} /></label></div><label>Delivery address<input required autoComplete="street-address" value={authProfile.address} onChange={(event) => setAuthProfile({ ...authProfile, address: event.target.value })} /></label><label>Mobile number<input required type="tel" autoComplete="tel" placeholder="09XX XXX XXXX" value={authProfile.phone} onChange={(event) => setAuthProfile({ ...authProfile, phone: event.target.value })} /></label><div className="name-fields"><label>Password<input required type="password" autoComplete="new-password" minLength={6} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /></label><label>Confirm password<input required type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label></div><div id="phone-recaptcha" />{authError && <div className="form-error">{authError}</div>}<button className="submit-button" disabled={busy}>{busy ? "Sending code..." : "Verify mobile number"}<ArrowRight size={16} /></button></> : <><label>SMS verification code<input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6-digit code" value={otpCode} onChange={(event) => setOtpCode(event.target.value)} /></label><p className="otp-help">Enter the code we sent to {normalizePhone(authProfile.phone)}.</p>{authError && <div className="form-error">{authError}</div>}<button className="submit-button" disabled={busy}>{busy ? "Verifying..." : "Create my account"}<ArrowRight size={16} /></button><button type="button" className="text-button" onClick={() => { setCodeSent(false); setOtpCode(""); }}>Back to your details</button></>}
            <button type="button" className="text-button" onClick={() => showSignIn("login")}>Already have an account? Sign in</button></form>}
          </>}
        </section></div>}

      {orderProduct && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrderProduct(null); }}><section className="dialog order-dialog" role="dialog" aria-modal="true" aria-labelledby="pickup-title"><button className="dialog-close" onClick={() => setOrderProduct(null)} aria-label="Close"><X size={19} /></button><div className="order-dialog-photo" style={{ backgroundImage: `url("${orderProduct.imageUrl}")` }} /><div className="dialog-kicker">MAKE IT A GATHERING</div><h2 id="pickup-title">Save your spot.</h2><p className="order-summary"><strong>{orderProduct.name}</strong><span>{peso(orderProduct.price)}</span></p><form className="auth-form" onSubmit={placeOrder}><label>Pickup date<input required type="date" min={today} value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} /></label><label>Pickup time<select required value={pickupTime} onChange={(event) => setPickupTime(event.target.value)}><option value="">Choose a time</option>{["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"].map((time) => <option key={time} value={time}>{new Date(`2000-01-01T${time}`).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</option>)}</select></label>{!signedIn && <div className="pickup-note">Sign in or try a preview to confirm your pickup.</div>}<button className="submit-button" disabled={busy}>{busy ? "Saving your pickup..." : "Confirm pickup"}<ArrowRight size={16} /></button></form></section></div>}

      {productDraft && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setProductDraft(null); setEditingProduct(null); } }}><section className="dialog product-dialog" role="dialog" aria-modal="true" aria-labelledby="product-form-title"><button className="dialog-close" onClick={() => { setProductDraft(null); setEditingProduct(null); }} aria-label="Close"><X size={19} /></button><div className="dialog-kicker">THE CKB MENU</div><h2 id="product-form-title">{editingProduct ? "Edit menu item." : "Add something good."}</h2><form className="auth-form" onSubmit={saveProduct}><label>Order name<input required value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} /></label><label>Description<textarea required rows={3} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} /></label><label>Price (₱)<input type="number" required min="0" step="0.01" value={productDraft.price || ""} onChange={(event) => setProductDraft({ ...productDraft, price: Number(event.target.value) })} /></label><label>Sale type<select value={productDraft.saleType} onChange={(event) => setProductDraft({ ...productDraft, saleType: event.target.value as Product["saleType"] })}><option value="regular">Regular</option><option value="promo">Promo</option></select></label>{productDraft.saleType === "promo" && <div className="name-fields"><label>Date from<input required type="date" value={productDraft.promoFrom || ""} onChange={(event) => setProductDraft({ ...productDraft, promoFrom: event.target.value })} /></label><label>Date to<input required type="date" value={productDraft.promoTo || ""} onChange={(event) => setProductDraft({ ...productDraft, promoTo: event.target.value })} /></label></div>}<label>Upload image<input type="file" accept="image/*" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /></label>{!firebaseEnabled && <div className="pickup-note">Preview images and menu changes are saved in this browser.</div>}<button className="submit-button" disabled={busy}>{busy ? "Saving..." : editingProduct ? "Save changes" : "Add to menu"}<ArrowRight size={16} /></button></form></section></div>}
    </main>
  );
}

function ArrowUpRightIcon() {
  return <ArrowRight size={17} strokeWidth={2.2} />;
}