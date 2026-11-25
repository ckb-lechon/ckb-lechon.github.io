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
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
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
  Banknote,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  ClipboardCheck,
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
  UsersRound,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { auth, db, firebaseEnabled } from "@/lib/firebase";
import OrderConversation from "./OrderConversation";

const uploadThingUrl = process.env.NEXT_PUBLIC_UPLOADTHING_URL || "";
const uploadThingConfigured = Boolean(uploadThingUrl);
type CkbUploadRouter = { productImage: AnyFileRoute };
const { uploadFiles } = generateReactHelpers<CkbUploadRouter>({ url: uploadThingUrl || "/api/uploadthing" });

const orderNames = [
  "Belly",
  "Belly Bilao",
  "Belly Bilao Food Package",
  "Karne Kinilo",
  "Lechon Food Package",
  "Lechon Kinilo",
  "Tray",
  "Whole Lechon",
] as const;
const mobileMenuMessages = [
  "Lami kaayo barato pa gyud.",
  "Walay kahumanan nga promo.",
  "Located ra deay sa P-11 Obrero.",
  "Pwede maka-Maxim sa order.",
] as const;
type OrderName = (typeof orderNames)[number];

function normalizeOrderName(value: string | undefined): OrderName {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[-_]/g, " ");
  const exactMatch = orderNames.find((orderName) => orderName.toLowerCase() === normalized);
  if (exactMatch) return exactMatch;
  const partialMatch = [...orderNames]
    .sort((left, right) => right.length - left.length)
    .find((orderName) => normalized.includes(orderName.toLowerCase()));
  return partialMatch ?? orderNames[0];
}

function menuCategoryId(orderName: OrderName) {
  return `menu-category-${orderNames.indexOf(orderName)}`;
}

type Product = {
  id: string;
  name: string;
  orderName: OrderName;
  description: string;
  food?: string[];
  stock?: number;
  lastStockOrderId?: string;
  price: number;
  kiloPrices?: Record<string, number>;
  saleType: "regular" | "promo";
  promoFrom?: string;
  promoTo?: string;
  imageUrl: string;
  active: boolean;
};
type KiloPriceDraft = { kilo: number; price: number };

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
  description?: string;
  descriptionDone?: boolean;
  food?: string[];
  cookedFoodIndexes?: number[];
  policyAccepted?: boolean;
  policyAcceptedAt?: number;
  quantity: number;
  kilo?: string;
  stockDeducted?: boolean;
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

type Tab = "shop" | "orders" | "admin" | "checklist" | "users";
type AuthMode = "login" | "signup";
type ManagedUser = { uid: string; name: string; email: string; role: "admin" | "user" };

const retiredSampleProductIds = new Set(["whole-lechon", "lechon-belly", "crispy-sisig"]);
const usersNavigationEmails = new Set([
  "jerosales00@gmail.com",
  "caerosales08@gmail.com",
  "leamayrosales1@gmail.com",
]);
const manilaUtcOffsetMs = 8 * 60 * 60 * 1000;

const blankProfile: Profile = { firstName: "", middleName: "", lastName: "", suffix: "", address: "", phone: "", email: "" };
const peso = (value: number) => `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const orderCancellationWindowMs = 2 * 60 * 60 * 1000;
const productCollection = () => collection(db!, "products");
const orderCollection = () => collection(db!, "orders");
const profilePath = (uid: string) => doc(db!, "users", uid);

function kiloPriceOptions(product: Product | null | undefined) {
  return Object.entries(product?.kiloPrices ?? {})
    .map(([kilo, price]) => ({ kilo, price }))
    .filter((option) => Number.isFinite(Number(option.kilo)) && Number(option.kilo) > 0
      && Number.isFinite(option.price) && option.price >= 0)
    .sort((left, right) => Number(left.kilo) - Number(right.kilo));
}

function productPriceLabel(product: Product) {
  const options = kiloPriceOptions(product);
  return product.orderName === "Whole Lechon" && options.length > 0
    ? `Starts from ${peso(Math.min(...options.map((option) => option.price)))}`
    : peso(product.price);
}

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

function deliveredDateKey(order: CustomerOrder) {
  return typeof order.deliveredAt === "number" && Number.isFinite(order.deliveredAt)
    ? manilaDateKey(new Date(order.deliveredAt))
    : order.pickupDate;
}

function isPromoExpired(product: Product, dateKey: string) {
  return product.saleType === "promo" && Boolean(product.promoTo && dateKey > product.promoTo);
}

function isPickupDateEligible(product: Product, pickupDate: string) {
  if (product.saleType !== "promo") return true;
  return Boolean(product.promoFrom && product.promoTo
    && pickupDate >= product.promoFrom
    && pickupDate <= product.promoTo);
}

function allowsDecimalQuantity(orderName: OrderName) {
  return orderName === "Lechon Kinilo" || orderName === "Karne Kinilo";
}

function supportsStock(orderName: OrderName) {
  return orderName === "Lechon Kinilo" || orderName === "Karne Kinilo";
}

function isValidOrderQuantity(quantity: number, allowDecimals: boolean) {
  if (!Number.isFinite(quantity) || quantity > 99) return false;
  return allowDecimals
    ? quantity >= 0.01
    : quantity >= 1 && Number.isInteger(quantity);
}

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [profile, setProfile] = useState<Profile>(blankProfile);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState(false);
  const [demoMode, setDemoMode] = useState<"customer" | "admin" | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("shop");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [postAuthTab, setPostAuthTab] = useState<Tab | null>(null);
  const [orderProduct, setOrderProduct] = useState<Product | null>(null);
  const [orderPolicyConfirmationOpen, setOrderPolicyConfirmationOpen] = useState(false);
  const [rescheduleDraft, setRescheduleDraft] = useState<{ order: CustomerOrder; pickupDate: string; pickupTime: string } | null>(null);
  const [selectedOrderProduct, setSelectedOrderProduct] = useState<Product | null>(null);
  const [cancelOrderConfirmation, setCancelOrderConfirmation] = useState<CustomerOrder | null>(null);
  const [orderActionConfirmation, setOrderActionConfirmation] = useState<{ order: CustomerOrder; action: "payment" | "delivered" } | null>(null);
  const [foodChecklistConfirmation, setFoodChecklistConfirmation] = useState<{ order: CustomerOrder; itemType: "description" | "food"; foodIndex: number; foodName: string; nextChecked: boolean } | null>(null);
  const [productRemovalConfirmation, setProductRemovalConfirmation] = useState<Product | null>(null);
  const [confirmingOrderActionId, setConfirmingOrderActionId] = useState<string | null>(null);
  const [updatingFoodChecklistId, setUpdatingFoodChecklistId] = useState<string | null>(null);
  const [reschedulingOrderId, setReschedulingOrderId] = useState<string | null>(null);
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false);
  const [downpaymentQrOpen, setDownpaymentQrOpen] = useState(false);
  const [conversationOrder, setConversationOrder] = useState<CustomerOrder | null>(null);
  const [unreadMessageCounts, setUnreadMessageCounts] = useState<Record<string, number>>({});
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
  const [foodInput, setFoodInput] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [orderKilo, setOrderKilo] = useState("");
  const [kiloPriceRows, setKiloPriceRows] = useState<KiloPriceDraft[]>([]);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [deliveredDateFilter, setDeliveredDateFilter] = useState("");
  const [deliveredMonthFilter, setDeliveredMonthFilter] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [today, setToday] = useState("");
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const [removingProductId, setRemovingProductId] = useState<string | null>(null);
  const [changingRoleUid, setChangingRoleUid] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState("");
  const [selectedPickupDate, setSelectedPickupDate] = useState("");
  const [expandedChecklistOrders, setExpandedChecklistOrders] = useState<Record<string, boolean>>({});
  const [activeMenuCategory, setActiveMenuCategory] = useState<OrderName | "">("");
  const canManage = Boolean(admin && (currentUser || demoMode));
  const canManageUsers = Boolean(
    canManage
      && currentUser?.email
      && usersNavigationEmails.has(currentUser.email.trim().toLowerCase()),
  );
  const menuProducts = products.filter((product) => !today || !isPromoExpired(product, today));
  const menuCategories = orderNames.filter((orderName) => menuProducts.some((product) => product.orderName === orderName));
  const menuCategoryKey = menuCategories.join("|");
  const currentUserId = currentUser?.uid;
  const conversationOrderIds = orders.filter((order) => order.status !== "cancelled").map((order) => order.id).sort().join("|");
  const adminMenuProducts = [...products].sort((a, b) =>
    a.orderName.localeCompare(b.orderName, undefined, { sensitivity: "base" })
      || a.description.localeCompare(b.description, undefined, { sensitivity: "base" }),
  );
  const orderKiloOptions = kiloPriceOptions(orderProduct);
  const orderUnitPrice = orderProduct?.orderName === "Whole Lechon"
    ? orderProduct.kiloPrices?.[orderKilo]
    : orderProduct?.price;
  const orderTotal = (orderUnitPrice ?? 0) * (Number(orderQuantity) || 0);

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
    let stopProfile: (() => void) | undefined;
    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopProfile?.();
      stopProfile = undefined;
      setCurrentUser(user);
      setDemoMode(null);
      if (!user) {
        setProfile(blankProfile);
        setAdmin(false);
        setActiveTab("shop");
        setOrders([]);
        setUsers([]);
        return;
      }
      stopProfile = onSnapshot(profilePath(user.uid), (snapshot) => {
        const userProfile = snapshot.exists() ? snapshot.data() : null;
        const isStaff = userProfile?.role === "admin";
        setProfile(userProfile ? userProfile as Profile : blankProfile);
        setAdmin(isStaff);
        if (isStaff) setActiveTab("admin");
        else setActiveTab((current) => current === "admin" || current === "checklist" || current === "users" ? "shop" : current);
      });
    });
    return () => {
      stopAuth();
      stopProfile?.();
    };
  }, []);

  useEffect(() => {
    if ((activeTab === "admin" || activeTab === "checklist") && !canManage) {
      setActiveTab("shop");
    } else if (activeTab === "users" && !canManageUsers) {
      setActiveTab(canManage ? "admin" : "shop");
    }
  }, [activeTab, canManage, canManageUsers]);

  useEffect(() => {
    const categories = menuCategoryKey ? menuCategoryKey.split("|") as OrderName[] : [];
    setActiveMenuCategory((current) => categories.includes(current as OrderName) ? current : categories[0] ?? "");
  }, [menuCategoryKey]);

  useEffect(() => {
    if (activeTab !== "shop" || !menuCategoryKey) return;
    const categories = menuCategoryKey.split("|") as OrderName[];
    const headings = categories
      .map((orderName) => document.getElementById(menuCategoryId(orderName)))
      .filter((heading): heading is HTMLElement => heading instanceof HTMLElement);
    if (headings.length === 0) return;

    let frame = 0;
    const updateActiveCategory = () => {
      if (window.matchMedia("(max-width: 640px)").matches) {
        const filterBottom = document.querySelector<HTMLElement>(".mobile-category-filter")?.getBoundingClientRect().bottom ?? 136;
        const activeLine = filterBottom + 18;
        let currentHeading = headings[0];
        for (const heading of headings) {
          if (heading.getBoundingClientRect().top > activeLine) break;
          currentHeading = heading;
        }
        const orderName = currentHeading.dataset.menuCategory as OrderName | undefined;
        if (orderName) setActiveMenuCategory(orderName);
      }
    };
    const scheduleUpdate = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateActiveCategory);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeTab, menuCategoryKey]);

  useEffect(() => {
    if (!firebaseEnabled || !db || demoMode) return;
    const productsQuery = query(productCollection(), where("active", "==", true));
    const stopProducts = onSnapshot(productsQuery, (snapshot) => {
      const list = snapshot.docs
        .map((item) => {
          const data = item.data() as Omit<Product, "id" | "orderName"> & { orderName?: string };
          const orderName = normalizeOrderName(data.orderName ?? data.name);
          const food = Array.isArray(data.food) ? data.food.filter((value): value is string => typeof value === "string") : [];
          return { id: item.id, ...data, food, name: orderName, orderName } as Product;
        })
        .filter((item) => !retiredSampleProductIds.has(item.id) && (admin || item.active))
        .sort((left, right) => orderNames.indexOf(left.orderName) - orderNames.indexOf(right.orderName) || left.name.localeCompare(right.name));
      setProducts(list);
    });
    let stopOrders: (() => void) | undefined;
    if (currentUser) {
      const ordersQuery = admin ? orderCollection() : query(orderCollection(), where("userId", "==", currentUser.uid));
      stopOrders = onSnapshot(ordersQuery, (snapshot) => {
        const list = snapshot.docs
          .map((item) => {
            const data = item.data() as Omit<CustomerOrder, "id">;
            return {
              id: item.id,
              ...data,
              descriptionDone: data.descriptionDone === true,
              food: Array.isArray(data.food) ? data.food.filter((value): value is string => typeof value === "string") : undefined,
              cookedFoodIndexes: Array.isArray(data.cookedFoodIndexes)
                ? data.cookedFoodIndexes.filter((value): value is number => Number.isInteger(value) && value >= 0)
                : [],
            } as CustomerOrder;
          })
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
    const messageListIsVisible = canManage ? activeTab === "admin" : activeTab === "orders";
    if (!firebaseEnabled || !db || !currentUserId || demoMode || !conversationOrderIds || !messageListIsVisible) {
      setUnreadMessageCounts({});
      return;
    }

    const userId = currentUserId;
    const orderIds = conversationOrderIds.split("|");
    const unsubscribeAll: (() => void)[] = [];
    setUnreadMessageCounts({});

    for (const orderId of orderIds) {
      let messages: { senderId?: string; createdAt?: Timestamp }[] = [];
      let lastReadAt: Timestamp | null = null;
      const updateUnreadCount = () => {
        const count = messages.filter((message) =>
          message.senderId !== userId
          && message.createdAt
          && (!lastReadAt || message.createdAt.toMillis() > lastReadAt.toMillis()),
        ).length;
        setUnreadMessageCounts((current) => current[orderId] === count ? current : { ...current, [orderId]: count });
      };

      unsubscribeAll.push(onSnapshot(
        query(collection(db, "orders", orderId, "messages"), orderBy("createdAt", "asc")),
        (snapshot) => {
          messages = snapshot.docs.map((item) => item.data() as { senderId?: string; createdAt?: Timestamp });
          updateUnreadCount();
        },
        () => {
          messages = [];
          updateUnreadCount();
        },
      ));
      unsubscribeAll.push(onSnapshot(doc(db, "orders", orderId, "readStates", userId), (snapshot) => {
        lastReadAt = (snapshot.data()?.lastReadAt as Timestamp | undefined) ?? null;
        updateUnreadCount();
      }, () => {
        lastReadAt = null;
        updateUnreadCount();
      }));
    }

    return () => unsubscribeAll.forEach((unsubscribe) => unsubscribe());
  }, [activeTab, canManage, conversationOrderIds, currentUserId, demoMode]);

  useEffect(() => {
    if (!firebaseEnabled || !db || !currentUser || !canManageUsers || demoMode) {
      setUsers([]);
      setUsersLoading(false);
      return;
    }
    setUsersLoading(true);
    return onSnapshot(collection(db, "users"), (snapshot) => {
      const list = snapshot.docs.map((item) => {
        const data = item.data() as Partial<Profile> & { role?: string };
        const name = [data.firstName, data.middleName, data.lastName, data.suffix].filter(Boolean).join(" ");
        return {
          uid: item.id,
          name: name || "Unnamed user",
          email: data.email || "",
          role: data.role === "admin" ? "admin" as const : "user" as const,
        };
      }).sort((left, right) => left.name.localeCompare(right.name));
      setUsers(list);
      setUsersLoading(false);
    }, (error) => {
      setUsersLoading(false);
      setNotice(`Unable to load users: ${error.message}`);
    });
  }, [canManageUsers, currentUser, demoMode]);

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
      const userProfile = data.exists() ? data.data() : null;
      if (userProfile) setProfile(userProfile as Profile);
      setAuthOpen(false);
      const isStaff = userProfile?.role === "admin";
      setAdmin(isStaff);
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

  function requestOrderPolicyConfirmation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrderPolicyConfirmationOpen(true);
  }

  async function confirmOrderPolicy() {
    if (busy) return;
    setOrderPolicyConfirmationOpen(false);
    await placeOrder();
  }

  async function placeOrder() {
    if (!orderProduct || !pickupDate || !pickupTime) return;
    const quantity = Number(orderQuantity);
    if (isPromoExpired(orderProduct, manilaDateKey(new Date()))) {
      setOrderProduct(null);
      setNotice("This promo has ended and is no longer available.");
      return;
    }
    if (!isPickupDateEligible(orderProduct, pickupDate)) {
      setNotice("Choose a pickup date within this promo period.");
      return;
    }
    const selectedUnitPrice = orderProduct.orderName === "Whole Lechon"
      ? orderProduct.kiloPrices?.[orderKilo]
      : orderProduct.price;
    if (typeof selectedUnitPrice !== "number" || !Number.isFinite(selectedUnitPrice)) {
      setNotice("Choose a kilo option with a valid price.");
      return;
    }
    const allowDecimals = allowsDecimalQuantity(orderProduct.orderName);
    if (!isValidOrderQuantity(quantity, allowDecimals)) {
      setNotice(allowDecimals
        ? "Choose a quantity from 0.01 to 99."
        : "Choose a whole quantity from 1 to 99.");
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
      description: orderProduct.description,
      descriptionDone: false,
      food: orderProduct.food ?? [],
      cookedFoodIndexes: [],
      quantity,
      ...(orderProduct.orderName === "Whole Lechon" ? { kilo: orderKilo } : {}),
      total: selectedUnitPrice * quantity,
      downpayment: 0,
      pickupDate,
      pickupTime,
      paymentStatus: "due",
      status: "pending",
      createdAt: Date.now(),
      policyAccepted: true,
      policyAcceptedAt: Date.now(),
    };
    setBusy(true);
    try {
      if (demoMode) {
        if (supportsStock(orderProduct.orderName)) {
          const stockedProduct = products.find((product) => product.id === orderProduct.id);
          if (typeof stockedProduct?.stock !== "number" || !Number.isFinite(stockedProduct.stock)) {
            throw new Error("Stock is not set for this menu item. Please contact us.");
          }
          if (quantity > stockedProduct.stock) {
            throw new Error(`Only ${stockedProduct.stock} in stock. Reduce your quantity and try again.`);
          }
          const nextProducts = products.map((product) => product.id === stockedProduct.id
            ? { ...product, stock: product.stock! - quantity }
            : product);
          setProducts(nextProducts);
          localStorage.setItem("ckb-demo-products", JSON.stringify(nextProducts));
        }
        const placedOrder = {
          ...order,
          ...(supportsStock(orderProduct.orderName) ? { stockDeducted: true } : {}),
        };
        const nextOrders = [{ ...placedOrder, id: crypto.randomUUID() }, ...orders];
        setOrders(nextOrders);
        localStorage.setItem("ckb-demo-orders", JSON.stringify(nextOrders));
      } else if (db && currentUser) {
        if (supportsStock(orderProduct.orderName)) {
          const productRef = doc(db, "products", orderProduct.id);
          const orderRef = doc(orderCollection());
          await runTransaction(db, async (transaction) => {
            const productSnapshot = await transaction.get(productRef);
            if (!productSnapshot.exists()) throw new Error("This menu item is no longer available.");
            const productData = productSnapshot.data();
            const currentOrderName = normalizeOrderName(productData.orderName ?? productData.name);
            if (!productData.active || !supportsStock(currentOrderName)) {
              throw new Error("This menu item is no longer available. Refresh the menu and try again.");
            }
            if (typeof productData.stock !== "number" || !Number.isFinite(productData.stock)) {
              throw new Error("Stock is not set for this menu item. Please contact us.");
            }
            if (quantity > productData.stock) {
              throw new Error(`Only ${productData.stock} in stock. Reduce your quantity and try again.`);
            }
            transaction.update(productRef, {
              stock: productData.stock - quantity,
              lastStockOrderId: orderRef.id,
            });
            transaction.set(orderRef, {
              ...order,
              stockDeducted: true,
              productName: currentOrderName,
              imageUrl: productData.imageUrl,
              description: productData.description,
              food: Array.isArray(productData.food) ? productData.food : [],
              total: productData.price * quantity,
            });
          });
        } else if (orderProduct.orderName === "Whole Lechon") {
          const productRef = doc(db, "products", orderProduct.id);
          const orderRef = doc(orderCollection());
          await runTransaction(db, async (transaction) => {
            const productSnapshot = await transaction.get(productRef);
            if (!productSnapshot.exists()) throw new Error("This menu item is no longer available.");
            const productData = productSnapshot.data();
            const currentOrderName = normalizeOrderName(productData.orderName ?? productData.name);
            const currentKiloPrice = (productData.kiloPrices as Record<string, number> | undefined)?.[orderKilo];
            if (!productData.active || currentOrderName !== "Whole Lechon" || typeof currentKiloPrice !== "number") {
              throw new Error("This kilo option is no longer available. Refresh the menu and try again.");
            }
            if (currentKiloPrice !== selectedUnitPrice) {
              throw new Error("The price for this kilo changed. Close the order and open it again to refresh the price.");
            }
            transaction.set(orderRef, {
              ...order,
              productName: currentOrderName,
              imageUrl: productData.imageUrl,
              description: productData.description,
              food: Array.isArray(productData.food) ? productData.food : [],
              total: currentKiloPrice * quantity,
            });
          });
        } else {
          await addDoc(orderCollection(), order);
        }
      } else {
        setBusy(false);
        showSignIn("login");
        return;
      }
      setActiveTab("orders");
      setOrderProduct(null);
      setOrderQuantity("1");
      setOrderKilo("");
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
    if (productDraft.orderName === "Whole Lechon") {
      if (kiloPriceRows.length === 0) {
        setNotice("Add at least one kilo and price for Whole Lechon.");
        return;
      }
      if (kiloPriceRows.some(({ kilo, price }) => !Number.isFinite(kilo) || kilo <= 0 || !Number.isFinite(price) || price < 0)) {
        setNotice("Enter a valid kilo greater than zero and a non-negative price for each option.");
        return;
      }
      if (new Set(kiloPriceRows.map(({ kilo }) => String(Number(kilo)))).size !== kiloPriceRows.length) {
        setNotice("Each Whole Lechon kilo option must be unique.");
        return;
      }
    }
    if (supportsStock(productDraft.orderName) && productDraft.stock !== undefined
      && (!Number.isFinite(productDraft.stock) || productDraft.stock < 0)) {
      setNotice("Stock must be a non-negative number.");
      return;
    }
    if (productDraft.saleType === "promo" && (!productDraft.promoFrom || !productDraft.promoTo || productDraft.promoFrom > productDraft.promoTo)) {
      setNotice("Choose valid Date From and Date To values for this promo.");
      return;
    }
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
      const { id, stock, ...draftData } = productDraft;
      delete draftData.kiloPrices;
      const kiloPrices = Object.fromEntries(kiloPriceRows
        .map(({ kilo, price }) => [String(Number(kilo)), price] as const)
        .sort(([left], [right]) => Number(left) - Number(right)));
      const startingPrice = productDraft.orderName === "Whole Lechon"
        ? Math.min(...kiloPriceRows.map(({ price }) => price))
        : productDraft.price;
      const data = {
        ...draftData,
        price: startingPrice,
        ...(productDraft.orderName === "Whole Lechon" ? { kiloPrices } : {}),
        food: foodInput.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
        ...(supportsStock(productDraft.orderName) && stock !== undefined ? { stock } : {}),
        name: productDraft.orderName,
        imageUrl,
        active: true,
      };
      if (demoMode) {
        const next = editingProduct ? products.map((item) => item.id === id ? { id, ...data } : item) : [...products, { id: crypto.randomUUID(), ...data }];
        setProducts(next);
        localStorage.setItem("ckb-demo-products", JSON.stringify(next));
      } else if (db && currentUser && admin) {
        if (editingProduct) {
          const updates = {
            ...data,
            ...(supportsStock(productDraft.orderName) && stock !== undefined ? {} : { stock: deleteField() }),
            ...(productDraft.orderName === "Whole Lechon" ? {} : { kiloPrices: deleteField() }),
          };
          await updateDoc(doc(db, "products", id), updates);
        }
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

  async function deleteProduct(product: Product): Promise<boolean> {
    if (removingProductId) return false;
    setRemovingProductId(product.id);
    try {
      if (demoMode) {
        const next = products.filter((item) => item.id !== product.id);
        setProducts(next);
        localStorage.setItem("ckb-demo-products", JSON.stringify(next));
      } else if (db && currentUser && admin) {
        await deleteDoc(doc(db, "products", product.id));
        setProducts((current) => current.filter((item) => item.id !== product.id));
      } else {
        setNotice("Admin access is required to remove menu items.");
        return false;
      }
      setNotice("Menu item removed.");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? `Unable to remove menu item: ${error.message}` : "Unable to remove this menu item.");
      return false;
    } finally {
      setRemovingProductId(null);
    }
  }

  async function confirmProductRemoval() {
    if (!productRemovalConfirmation || removingProductId) return;
    const removed = await deleteProduct(productRemovalConfirmation);
    if (removed) setProductRemovalConfirmation(null);
  }

  async function updateOrder(id: string, changes: Partial<CustomerOrder>) {
    const order = orders.find((item) => item.id === id);
    if (order?.status === "delivered" && (
      ("status" in changes && changes.status !== "delivered")
      || ("downpayment" in changes && changes.downpayment !== (order.downpayment ?? 0))
      || ("paymentStatus" in changes && changes.paymentStatus !== "paid")
    )) {
      setNotice("Delivered orders cannot be marked unpaid or have their status or downpayment changed.");
      return;
    }
    if (demoMode) {
      const nextOrders = orders.map((item) => item.id === id ? { ...item, ...changes } : item);
      setOrders(nextOrders);
      localStorage.setItem("ckb-demo-orders", JSON.stringify(nextOrders));
    } else if (db && admin) {
      await updateDoc(doc(db, "orders", id), changes);
    }
    setNotice("Order updated.");
  }

  async function confirmOrderAction() {
    if (!orderActionConfirmation || confirmingOrderActionId) return;
    const { order, action } = orderActionConfirmation;
    const currentOrder = orders.find((item) => item.id === order.id);
    if (!currentOrder) {
      setOrderActionConfirmation(null);
      setNotice("This order is no longer available.");
      return;
    }
    if (action === "payment" && orderBalance(currentOrder) === 0) {
      setOrderActionConfirmation(null);
      setNotice("This order is already fully paid.");
      return;
    }
    if (action === "delivered" && currentOrder.status !== "pending") {
      setOrderActionConfirmation(null);
      setNotice("This order can no longer be marked delivered.");
      return;
    }
    if (action === "delivered" && orderBalance(currentOrder) > 0) {
      setOrderActionConfirmation(null);
      setNotice("Collect the remaining balance before marking this order delivered.");
      return;
    }

    setConfirmingOrderActionId(currentOrder.id);
    try {
      await updateOrder(currentOrder.id, action === "payment"
        ? { paymentStatus: "paid" }
        : { status: "delivered", deliveredAt: Date.now() });
      setOrderActionConfirmation(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update this order.");
    } finally {
      setConfirmingOrderActionId(null);
    }
  }

  async function confirmFoodChecklist() {
    if (!foodChecklistConfirmation || updatingFoodChecklistId) return;
    const { order: requestedOrder, itemType, foodIndex, foodName, nextChecked } = foodChecklistConfirmation;
    const order = orders.find((item) => item.id === requestedOrder.id);
    if (!order || order.status === "cancelled") {
      setFoodChecklistConfirmation(null);
      setNotice("This order is no longer available for the checklist.");
      return;
    }
    const food = foodForOrder(order);
    const description = descriptionForOrder(order);
    if ((itemType === "description" ? description : food[foodIndex]) !== foodName) {
      setFoodChecklistConfirmation(null);
      setNotice("This checklist item has changed. Refresh the checklist and try again.");
      return;
    }

    const checkedIndexes = new Set(order.cookedFoodIndexes ?? []);
    if (itemType === "food") {
      if (nextChecked) checkedIndexes.add(foodIndex);
      else checkedIndexes.delete(foodIndex);
    }

    setUpdatingFoodChecklistId(order.id);
    try {
      await updateOrder(order.id, itemType === "description"
        ? { description, descriptionDone: nextChecked }
        : { food, cookedFoodIndexes: [...checkedIndexes].sort((left, right) => left - right) });
      setFoodChecklistConfirmation(null);
      setNotice(`${foodName} checklist updated.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update the checklist.");
    } finally {
      setUpdatingFoodChecklistId(null);
    }
  }

  function requestOrderReschedule(order: CustomerOrder) {
    if (order.status !== "pending") return;
    setRescheduleDraft({ order, pickupDate: order.pickupDate, pickupTime: order.pickupTime });
  }

  async function saveOrderReschedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rescheduleDraft || reschedulingOrderId) return;
    const order = orders.find((item) => item.id === rescheduleDraft.order.id);
    if (!order || order.status !== "pending") {
      setRescheduleDraft(null);
      setNotice("This order can no longer be rescheduled.");
      return;
    }
    const product = products.find((item) => item.id === order.productId);
    const earliestDate = today || localDateKey(new Date());
    if (rescheduleDraft.pickupDate < earliestDate || !rescheduleDraft.pickupTime) {
      setNotice("Choose a valid pickup date and time.");
      return;
    }
    if (product && !isPickupDateEligible(product, rescheduleDraft.pickupDate)) {
      setNotice("Choose a pickup date within this promo period.");
      return;
    }

    setReschedulingOrderId(order.id);
    try {
      await updateOrder(order.id, { pickupDate: rescheduleDraft.pickupDate, pickupTime: rescheduleDraft.pickupTime });
      setRescheduleDraft(null);
      setNotice("Pickup rescheduled.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to reschedule this pickup.");
    } finally {
      setReschedulingOrderId(null);
    }
  }

  async function updateUserRole(user: ManagedUser, role: ManagedUser["role"]) {
    if (!db || !admin || user.uid === currentUser?.uid || changingRoleUid) return;
    setChangingRoleUid(user.uid);
    try {
      await updateDoc(profilePath(user.uid), { role });
      setNotice(`${user.name} is ${role === "admin" ? "now an admin" : "no longer an admin"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? `Unable to update role: ${error.message}` : "Unable to update this user's role.");
    } finally {
      setChangingRoleUid(null);
    }
  }

  async function saveDownpayment(order: CustomerOrder, input: HTMLInputElement) {
    if (order.status === "delivered") {
      input.value = String(order.downpayment ?? 0);
      setNotice("Delivered orders cannot have their status or downpayment changed.");
      return;
    }
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
        const stockedProduct = products.find((product) => product.id === order.productId);
        if (order.stockDeducted === true && stockedProduct && supportsStock(stockedProduct.orderName)
          && typeof stockedProduct.stock === "number") {
          const nextProducts = products.map((product) => product.id === stockedProduct.id
            ? { ...product, stock: product.stock! + order.quantity }
            : product);
          setProducts(nextProducts);
          localStorage.setItem("ckb-demo-products", JSON.stringify(nextProducts));
        }
      } else if (db && currentUser) {
        const orderRef = doc(db, "orders", order.id);
        if (!supportsStock(normalizeOrderName(order.productName))) {
          await updateDoc(orderRef, { status: "cancelled", cancelledAt: serverTimestamp() });
        } else {
          await runTransaction(db, async (transaction) => {
            const orderSnapshot = await transaction.get(orderRef);
            if (!orderSnapshot.exists()) throw new Error("This order is no longer available.");
            const currentOrder = { id: orderSnapshot.id, ...orderSnapshot.data() } as CustomerOrder;
            if (!canCancelOrder(currentOrder, Date.now())) {
              throw new Error("This order can no longer be cancelled.");
            }
            if (currentOrder.stockDeducted === true) {
              const productRef = doc(db!, "products", currentOrder.productId);
              const productSnapshot = await transaction.get(productRef);
              if (productSnapshot.exists()) {
                const productData = productSnapshot.data();
                const productOrderName = normalizeOrderName(productData.orderName ?? productData.name);
                if (supportsStock(productOrderName)) {
                  if (typeof productData.stock !== "number" || !Number.isFinite(productData.stock)) {
                    throw new Error("The menu stock is unavailable. Please contact us to cancel this order.");
                  }
                  transaction.update(productRef, {
                    stock: productData.stock + currentOrder.quantity,
                    lastStockOrderId: currentOrder.id,
                  });
                }
              }
            }
            transaction.update(orderRef, { status: "cancelled", cancelledAt: serverTimestamp() });
          });
        }
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
    setConversationOrder(null);
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
    const currentProducts = demoProducts
      .filter((product) => !retiredSampleProductIds.has(product.id))
      .map((product) => {
        const orderName = normalizeOrderName(product.orderName ?? product.name);
        return { ...product, name: orderName, orderName };
      });
    setProducts(currentProducts);
    localStorage.setItem("ckb-demo-products", JSON.stringify(currentProducts));
    setOrders(JSON.parse(localStorage.getItem("ckb-demo-orders") || "[]"));
    setActiveTab(role === "admin" ? "admin" : "shop");
    setNotice(`${role === "admin" ? "Staff" : "Customer"} preview opened. Changes are saved on this device only.`);
  }

  function openProductForm(product?: Product) {
    const orderName = normalizeOrderName(product?.orderName ?? product?.name);
    const item = product
      ? { ...product, food: product.food ?? [], name: orderName, orderName }
      : { id: "", name: orderName, orderName, description: "", food: [], price: 0, saleType: "regular" as const, imageUrl: "", active: true };
    setEditingProduct(product ?? null);
    setProductDraft({ ...item });
    setKiloPriceRows(kiloPriceOptions(item).map(({ kilo, price }) => ({ kilo: Number(kilo), price })));
    setFoodInput((product?.food ?? []).join(", "));
    setImageFile(null);
  }

  function openOrderProductCard(order: CustomerOrder) {
    const product = products.find((item) => item.id === order.productId);
    if (product) {
      setSelectedOrderProduct({ ...product, food: order.food ?? product.food ?? [] });
      return;
    }
    const orderName = normalizeOrderName(order.productName);
    setSelectedOrderProduct({
      id: order.productId,
      name: order.productName,
      orderName,
      description: "Menu details are no longer available.",
      food: order.food ?? [],
      price: order.quantity > 0 ? order.total / order.quantity : order.total,
      saleType: "regular",
      imageUrl: order.imageUrl,
      active: false,
    });
  }

  function requestOrder(product: Product) {
    if (!signedIn) {
      setOrderProduct(null);
      showSignIn("login");
      return;
    }
    setOrderPolicyConfirmationOpen(false);
    setOrderProduct(product);
    setOrderQuantity("1");
    setOrderKilo(kiloPriceOptions(product)[0]?.kilo ?? "");
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

  const adminOrders = orders.filter((order) => order.status !== "cancelled");
  const deliveredOrders = adminOrders
    .filter((order) => order.status === "delivered")
    .sort((left, right) => (right.deliveredAt ?? right.createdAt) - (left.deliveredAt ?? left.createdAt));
  const filteredDeliveredOrders = deliveredOrders.filter((order) => {
    const dateKey = deliveredDateKey(order);
    return (!deliveredDateFilter || dateKey === deliveredDateFilter)
      && (!deliveredMonthFilter || dateKey.slice(0, 7) === deliveredMonthFilter);
  });
  const filteredOrders = adminOrders
    .filter((order) => order.status !== "delivered"
      && order.pickupDate === selectedPickupDate
      && (dateFilter === "all" || (dateFilter === "pending" ? order.status === "pending" : orderBalance(order) > 0)))
    .sort((left, right) => right.createdAt - left.createdAt);
  const signedIn = Boolean(currentUser || demoMode);
  const orderOwnerId = currentUser?.uid ?? (demoMode === "customer" ? "demo-customer" : null);
  const myOrders = orderOwnerId ? orders.filter((order) => order.userId === orderOwnerId && order.status !== "cancelled") : [];
  const todayKey = localDateKey(new Date());
  const selectedDateTotalSold = orders.reduce((total, order) => {
    if (order.status !== "delivered") return total;
    const deliveredDate = deliveredDateKey(order);
    return deliveredDate === selectedPickupDate ? total + order.total : total;
  }, 0);
  const [calendarYear, calendarMonthNumber] = calendarMonth.split("-").map(Number);
  const calendarMonthDate = calendarMonth ? new Date(calendarYear, calendarMonthNumber - 1, 1) : null;
  const calendarOffset = calendarMonthDate ? calendarMonthDate.getDay() : 0;
  const calendarDays = calendarMonthDate
    ? Array.from({ length: new Date(calendarYear, calendarMonthNumber, 0).getDate() }, (_, index) => index + 1)
    : [];
  const calendarOrders = adminOrders;
  const ordersByPickupDate = calendarOrders.reduce<Record<string, CustomerOrder[]>>((groupedOrders, order) => {
    (groupedOrders[order.pickupDate] ??= []).push(order);
    return groupedOrders;
  }, {});
  const selectedDateOrders = ordersByPickupDate[selectedPickupDate] ?? [];
  const selectedChecklistOrders = selectedDateOrders.filter((order) => order.status === "pending").sort((left, right) =>
    left.pickupTime.localeCompare(right.pickupTime) || left.createdAt - right.createdAt,
  );

  function foodForOrder(order: CustomerOrder) {
    return order.food ?? products.find((product) => product.id === order.productId)?.food ?? [];
  }

  function descriptionForOrder(order: CustomerOrder) {
    return order.description ?? products.find((product) => product.id === order.productId)?.description ?? "";
  }

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
    const unreadCount = unreadMessageCounts[order.id] ?? 0;
    return (
      <article className="admin-order" key={order.id}>
        <div className="admin-customer"><div><strong>{order.customer}</strong><span>{order.address}</span><a href={`tel:${order.phone}`}>{order.phone}</a></div></div>
        <div className="admin-order-item"><div className="admin-order-photo" style={{ backgroundImage: `url("${order.imageUrl}")` }} /><div><button type="button" className="order-name-link" onClick={() => openOrderProductCard(order)}>{order.productName}</button><span>{order.kilo ? `${order.kilo} kg · ` : ""}{order.quantity} {order.quantity === 1 ? "item" : "items"} · {peso(order.total)}</span></div></div>
        <div className="admin-pickup"><span>PICKUP</span><strong>{formatDate(order.pickupDate)}</strong><span>{formatTime(order.pickupTime)}</span></div>
        <div className="admin-downpayment"><span>DOWNPAYMENT</span>{order.status === "delivered" ? <span className="downpayment-value">{peso(order.downpayment ?? 0)}</span> : <label className="downpayment-input">₱<input type="number" min="0" max={order.total} step="0.01" defaultValue={order.downpayment ?? 0} key={`${order.id}-${order.downpayment ?? 0}`} aria-label={`Downpayment for ${order.customer}`} onBlur={(event) => saveDownpayment(order, event.currentTarget)} /></label>}</div>
        <div className="admin-balance"><span>BALANCE</span><strong>{peso(orderBalance(order))}</strong>{order.paymentStatus === "paid" ? order.status === "delivered" ? <span className="payment-toggle paid">Fully paid</span> : <button className="payment-toggle paid" onClick={() => updateOrder(order.id, { paymentStatus: "due" })}>Fully paid</button> : orderBalance(order) === 0 ? <span className="payment-toggle paid">Fully paid</span> : <button className="payment-toggle" onClick={() => setOrderActionConfirmation({ order, action: "payment" })}>Fully Paid (Click Here)</button>}</div>
        <div className="admin-order-actions">
          {currentUser && <button className="order-message-button" aria-label={`Message ${order.customer}${unreadCount ? `, ${unreadCount} new messages` : ""}`} onClick={() => setConversationOrder(order)}>Message{unreadCount > 0 && <span className="unread-message-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>}
          {order.status === "cancelled" ? <button className="delivered-toggle cancelled" disabled>Cancelled</button> : order.status === "delivered" ? <button className="delivered-toggle delivered" disabled><Check size={15} /> Delivered</button> : <button className="delivered-toggle" onClick={() => setOrderActionConfirmation({ order, action: "delivered" })} disabled={orderBalance(order) > 0} title={orderBalance(order) > 0 ? "Collect the remaining balance before marking delivered." : undefined}>Mark delivered</button>}
        </div>
      </article>
    );
  }

  return (
    <main className="app-shell">
      {!firebaseEnabled && <div className="demo-ribbon"><Sparkles size={13} /> Preview mode · connect Firebase for live ordering</div>}
      {firebaseEnabled && demoMode && <div className="demo-ribbon"><Sparkles size={13} /> Local {demoMode} preview · changes stay on this device</div>}

      <header className={canManage ? "topbar admin-topbar" : "topbar"}>
        <button className="brand-lockup" onClick={() => setActiveTab("shop")} aria-label="CKB Lechon home">
          <span className="brand-stamp brand-icon" aria-hidden="true" />
          <span className="brand-words"><strong>CKB Lechon</strong><small>CK Bless Lechon House</small></span>
        </button>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button className={activeTab === "shop" ? "nav-link active" : "nav-link"} onClick={() => setActiveTab("shop")}>Menu</button>
          {signedIn && !canManage && <button className={activeTab === "orders" ? "nav-link active" : "nav-link"} onClick={requestOrders}>My Orders</button>}
          {canManage && <button className={activeTab === "admin" ? "nav-link active" : "nav-link"} onClick={() => setActiveTab("admin")}>Order List</button>}
          {canManage && <button className={activeTab === "checklist" ? "nav-link active" : "nav-link"} onClick={() => setActiveTab("checklist")}>Order Checklist</button>}
          {canManageUsers && <button className={activeTab === "users" ? "nav-link active" : "nav-link"} onClick={() => setActiveTab("users")}>Users</button>}
        </nav>
        <div className="topbar-actions">
          {!signedIn ? <button className="sign-in-button" onClick={() => showSignIn("login")}>Sign in <ArrowRight size={16} /></button> : <>
            <div className="profile-chip"><span className="profile-dot"><UserRound size={15} aria-hidden="true" /></span><span>{profile.firstName || "Account"}</span></div>
            <button className="mobile-menu" onClick={() => canManage ? setActiveTab("admin") : requestOrders()} aria-label={canManage ? "Order List" : "My Orders"} aria-current={activeTab === (canManage ? "admin" : "orders") ? "page" : undefined}>{canManage ? <List size={19} /> : <ShoppingBag size={19} />}</button>
            {canManage && <button className="mobile-menu" onClick={() => setActiveTab("checklist")} aria-label="Order Checklist" aria-current={activeTab === "checklist" ? "page" : undefined}><ClipboardCheck size={19} /></button>}
            {canManageUsers && <button className="mobile-menu" onClick={() => setActiveTab("users")} aria-label="Users" aria-current={activeTab === "users" ? "page" : undefined}><UsersRound size={19} /></button>}
            <button className="logout-button" onClick={requestLogout} aria-label="Log out" title="Log out"><LogOut size={16} /><span>Log out</span></button>
          </>}
        </div>
      </header>

      {activeTab === "shop" && <>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> THE TABLE IS WAITING</div>
            <h1 id="hero-title">Ang lami-an nga<br /><em>golden lechon.</em></h1>
            <p>Slow-roasted, proudly Filipino, and always worth gathering for.</p>
            <button className="hero-cta" onClick={() => document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" })}>Special Menu <ArrowDownRight size={17} /></button>
          </div>
          <div className="hero-photo" role="img" aria-label="A generous spread of grilled Filipino feast food">
            <div className="hero-note"><span>Made for</span><strong>the whole<br />pamilya.</strong><Sparkles size={17} /></div>
          </div>
          <div className="hero-side-note"><span>01 / 03</span><span className="side-line" /><span>ROASTED WITH HEART</span></div>
          <div className="hero-sun" aria-hidden="true">CKB</div>
        </section>

        <section className="menu-section" id="menu">
          <div className="mobile-contact-info">
            <div className="mobile-contact-location"><MapPin size={18} aria-hidden="true" /><span>Purok-11, Brgy. Obrero, Butuan City 8600</span></div>
            <div className="mobile-contact-facebook"><Facebook size={18} aria-hidden="true" /><span>Follow us on Facebook; just <a href="https://www.facebook.com/profile.php?id=100089199199223" target="_blank" rel="noreferrer">click here!</a></span></div>
          </div>
          <div className="mobile-message-marquee">
            <p className="mobile-message-description">Menu updates: {mobileMenuMessages.join(" ")}</p>
            <div className="mobile-message-track" aria-hidden="true">
              {[0, 1].map((copy) => <div className="mobile-message-group" key={copy}>{mobileMenuMessages.map((message) => <span className="mobile-message" key={message}><span className="mobile-message-spark">✦</span>{message}</span>)}</div>)}
            </div>
          </div>
          <div className="section-heading">
            <div><span className="eyebrow"><span className="eyebrow-line" /> Order na, presyong kaya.</span><h2>Special Menu</h2></div>
            <p>Fresh from our kitchen,<br />ready for your home.</p>
          </div>
          {menuCategories.length > 0 && <div className="mobile-category-filter">
            <div className="mobile-category-select-wrap">
              <select
                id="mobile-menu-category"
                aria-label="Browse category"
                value={menuCategories.includes(activeMenuCategory as OrderName) ? activeMenuCategory : menuCategories[0]}
                onChange={(event) => {
                  const orderName = event.target.value as OrderName;
                  setActiveMenuCategory(orderName);
                  document.getElementById(menuCategoryId(orderName))?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {menuCategories.map((orderName) => <option key={orderName} value={orderName}>{orderName}</option>)}
              </select>
              <ChevronDown size={17} aria-hidden="true" />
            </div>
          </div>}
          {menuProducts.length === 0 && <div className="empty-menu">Our kitchen is adding something special. Check back soon.</div>}
          {orderNames.map((orderName) => {
            const categoryProducts = menuProducts
              .filter((product) => product.orderName === orderName)
              .sort((a, b) => a.description.localeCompare(b.description, undefined, { sensitivity: "base" }));
            if (categoryProducts.length === 0) return null;
            const categoryId = menuCategoryId(orderName);
            return <section className="menu-category" key={orderName} aria-labelledby={categoryId}>
              <h3 className="menu-category-heading" id={categoryId} data-menu-category={orderName}>{orderName}</h3>
              <div className="product-grid">
                {categoryProducts.map((product, index) => {
                  const isPromo = product.saleType === "promo" && (!product.promoFrom || today >= product.promoFrom) && (!product.promoTo || today <= product.promoTo);
                  const stockUnavailable = supportsStock(product.orderName)
                    && (typeof product.stock !== "number" || product.stock <= 0);
                  const kiloPricingUnavailable = product.orderName === "Whole Lechon" && kiloPriceOptions(product).length === 0;
                  const orderUnavailable = stockUnavailable || kiloPricingUnavailable;
                  return <article className={`product-card product-card-${index % 3}`} key={product.id}>
                    <div className="product-image" style={{ backgroundImage: `url("${product.imageUrl}")` }}>
                      <span className={isPromo ? "product-tag promo-tag" : "product-tag"}>{isPromo ? <><Flame size={12} /> SPECIAL</> : "HOUSE FAVORITE"}</span>
                    </div>
                    <div className="product-info">
                      <div className="product-title-line"><h3>{product.orderName}</h3><span>{productPriceLabel(product)}</span></div>
                      {supportsStock(product.orderName) && <strong className="product-stock">Stock: {typeof product.stock === "number" ? product.stock : "Not set"}</strong>}
                      {product.food && product.food.length > 0 && <div className="product-food-tags" aria-label="Food included">{product.food.map((food, foodIndex) => <span className="product-food-tag" key={`${food}-${foodIndex}`}>{food}</span>)}</div>}
                      <p>{product.description}</p>
                      {isPromo && product.promoTo && <small className="promo-date">Promo through {formatDate(product.promoTo)}</small>}
                      {!admin && <button className="order-button" onClick={() => requestOrder(product)} disabled={orderUnavailable}>
                        {orderUnavailable ? kiloPricingUnavailable ? "Pricing unavailable" : product.stock === 0 ? "Out of stock" : "Unavailable" : "Order this"}
                        {!orderUnavailable && <ArrowRight size={15} />}
                      </button>}
                    </div>
                  </article>;
                })}
              </div>
            </section>;
          })}
        </section>

      </>}

      {activeTab === "orders" && signedIn && !canManage && <section className="dashboard-section">
        <div className="dashboard-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> YOUR CKB TABLE</span><h1>My orders<span className="heading-period">.</span></h1><p>Every good gathering starts with a plan.</p></div><button className="back-menu" onClick={() => setActiveTab("shop")}><ArrowLeft size={16} /> Back to menu</button></div>
        {myOrders.length === 0
          ? <div className="empty-state"><span className="empty-icon"><ShoppingBag /></span><h2>Your table is still open.</h2><p>Once you place an order, we’ll keep all the pickup details here.</p><button className="hero-cta" onClick={() => setActiveTab("shop")}>Browse the menu <ArrowRight size={16} /></button></div>
          : <div className="customer-order-list">{myOrders.map((order) => (
            <article className="customer-order" key={order.id}>
              <div className="order-thumb" style={{ backgroundImage: `url("${order.imageUrl}")` }} />
              <div className="customer-order-copy">
                <div className="customer-order-top"><h2>{order.productName}</h2></div>
                <p>{order.kilo ? `${order.kilo} kg · ` : ""}{order.quantity} {order.quantity === 1 ? "item" : "items"} · {peso(order.total)}<span className="inline-payment-note"> · {order.status === "delivered" ? "Delivered" : orderBalance(order) === 0 ? "Fully paid" : <>Balance due <strong>{peso(orderBalance(order))}</strong></>}</span></p>
                <div className="pickup-line"><CalendarDays size={15} />{formatDate(order.pickupDate)} <span>·</span><Clock3 size={15} />{formatTime(order.pickupTime)}</div>
              </div>
              <div className="customer-order-actions">
                {currentUser && <button className="order-message-button" aria-label={`Message ${order.productName}${unreadMessageCounts[order.id] ? `, ${unreadMessageCounts[order.id]} new messages` : ""}`} onClick={() => setConversationOrder(order)}>Message{(unreadMessageCounts[order.id] ?? 0) > 0 && <span className="unread-message-badge" aria-hidden="true">{(unreadMessageCounts[order.id] ?? 0) > 99 ? "99+" : unreadMessageCounts[order.id]}</span>}</button>}
                <button className="downpayment-qr-button" onClick={() => setDownpaymentQrOpen(true)}>Downpayment QR</button>
                {canCancelOrder(order, currentTime) && <button className="cancel-order-button" onClick={() => requestOrderCancellation(order)} disabled={cancelingOrderId === order.id}>{cancelingOrderId === order.id ? "Cancelling..." : "Cancel Order"}</button>}
              </div>
            </article>
          ))}</div>}
      </section>}

      {activeTab === "admin" && canManage && <section className="dashboard-section admin-section">
        <div className="dashboard-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> CKB LECHON HOUSE</span><h1>Pickup calendar<span className="heading-period">.</span></h1><p>Choose a pickup date to see its orders.</p></div><button className="add-menu-button" onClick={() => openProductForm()}><Plus size={16} /> Add menu item</button></div>
        <div className="admin-metrics"><div><span>ALL ORDERS</span><strong>{adminOrders.length.toString().padStart(2, "0")}</strong><PackageCheck size={17} /></div><div><span>NEEDS PAYMENT</span><strong>{adminOrders.filter((item) => orderBalance(item) > 0).length.toString().padStart(2, "0")}</strong><CircleHelp size={17} /></div><div><span>READY TO PICK UP</span><strong>{adminOrders.filter((item) => item.status === "pending").length.toString().padStart(2, "0")}</strong><Clock3 size={17} /></div><div><span>TOTAL SOLD</span><strong>{peso(selectedDateTotalSold)}</strong><Banknote size={17} /></div></div>
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
            {selectedDateOrders.length === 0 ? <div className="calendar-empty-state">No orders scheduled for this date.</div> : <div className="calendar-orders-table-wrap"><table className="calendar-orders-table pickup-calendar-orders-table"><thead><tr><th>Name</th><th>Order</th><th>Balance</th><th>Action</th></tr></thead><tbody>{selectedDateOrders.map((order) => <tr key={order.id}><td>{order.customer}</td><td>{order.quantity} {order.quantity === 1 ? "item" : "items"}{order.kilo ? ` · ${order.kilo} kg` : ""} · <button type="button" className="order-name-link" onClick={() => openOrderProductCard(order)}>{order.productName}</button></td><td><span className={orderBalance(order) === 0 ? "calendar-balance paid" : "calendar-balance"}>{orderBalance(order) === 0 ? "Paid" : peso(orderBalance(order))}</span></td><td><button type="button" className="reschedule-order-button" onClick={() => requestOrderReschedule(order)} disabled={order.status !== "pending"} title={order.status !== "pending" ? "Only pending orders can be rescheduled." : undefined}>Reschedule</button></td></tr>)}</tbody></table></div>}
          </section>
        </div>
        <div className="order-list-heading"><div><h2>The pickup list</h2><span>Orders for the selected pickup date.</span></div><select aria-label="Filter orders" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">All orders</option><option value="pending">Not yet delivered</option><option value="due">Needs full payment</option></select></div>
        {filteredOrders.length === 0 ? <div className="admin-empty">No pickup orders match this filter.</div> : <div className="admin-order-list">{filteredOrders.map(renderAdminOrder)}</div>}
        <div className="order-list-heading delivered-orders-heading">
          <div><h2>Delivered Orders</h2><span>Orders handed over to customers.</span></div>
          <div className="delivered-order-filters">
            <label>Specific date<input type="date" aria-label="Filter delivered orders by specific date" value={deliveredDateFilter} onChange={(event) => setDeliveredDateFilter(event.target.value)} /></label>
            <label>Month and year<input type="month" aria-label="Filter delivered orders by month and year" value={deliveredMonthFilter} onChange={(event) => setDeliveredMonthFilter(event.target.value)} /></label>
            {(deliveredDateFilter || deliveredMonthFilter) && <button type="button" className="delivered-filter-clear" onClick={() => { setDeliveredDateFilter(""); setDeliveredMonthFilter(""); }}>Clear filters</button>}
          </div>
        </div>
        {deliveredOrders.length === 0
          ? <div className="admin-empty">No delivered orders just yet.</div>
          : filteredDeliveredOrders.length === 0
            ? <div className="admin-empty">No delivered orders match these filters.</div>
            : <div className="admin-order-list">{filteredDeliveredOrders.map(renderAdminOrder)}</div>}
        <div className="admin-products-heading"><div><h2>Menu items</h2><span>Manage what customers can order.</span></div></div>
        {products.length === 0 ? <div className="admin-empty">No active menu items. Add an item to make it available to customers.</div> : <div className="admin-products-list">{adminMenuProducts.map((product) => <article key={product.id}><div className="admin-product-photo" style={{ backgroundImage: `url("${product.imageUrl}")` }} /><div className="admin-product-copy"><strong>{product.orderName}</strong><span>{peso(product.price)} · {product.saleType === "promo" ? `Promo${product.promoFrom ? ` from ${formatDate(product.promoFrom)}` : ""}` : "Regular"}</span></div>{isPromoExpired(product, today) && <span className="expired-promo-label">Expired Promo</span>}<button className="edit-product" onClick={() => openProductForm(product)}>Edit</button><button className="remove-product" onClick={() => setProductRemovalConfirmation(product)} disabled={removingProductId === product.id}>{removingProductId === product.id ? "Removing…" : "Remove"}</button></article>)}</div>}
      </section>}

      {activeTab === "checklist" && canManage && <section className="dashboard-section admin-section">
        <div className="dashboard-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> CKB LECHON HOUSE</span><h1>Order Checklist<span className="heading-period">.</span></h1><p>Mark food items done for each pickup.</p></div></div>
        <div className="admin-calendar-layout">
          <section className="admin-calendar-card" aria-labelledby="checklist-calendar-heading">
            <div className="admin-calendar-toolbar">
              <button className="calendar-nav-button" onClick={() => changeCalendarMonth(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button>
              <h2 id="checklist-calendar-heading">{calendarMonthDate?.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</h2>
              <button className="calendar-nav-button" onClick={() => changeCalendarMonth(1)} aria-label="Next month"><ChevronRight size={17} /></button>
              <button className="calendar-today-button" onClick={selectTodayInCalendar}>Today</button>
            </div>
            <div className="admin-calendar-weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
            <div className="admin-calendar-days">
              {Array.from({ length: calendarOffset }, (_, index) => <span className="admin-calendar-empty-day" key={`checklist-empty-${index}`} />)}
              {calendarDays.map((day) => {
                const dateKey = localDateKey(new Date(calendarYear, calendarMonthNumber - 1, day));
                const dayOrderCount = (ordersByPickupDate[dateKey] ?? []).filter((order) => order.status === "pending").length;
                return <button className={`admin-calendar-day${dateKey === selectedPickupDate ? " selected" : ""}${dateKey === todayKey ? " today" : ""}${dayOrderCount ? " has-orders" : ""}`} key={dateKey} onClick={() => setSelectedPickupDate(dateKey)} aria-pressed={dateKey === selectedPickupDate} aria-label={`${formatCalendarDate(dateKey, { weekday: "long", month: "long", day: "numeric" })}, ${dayOrderCount} ${dayOrderCount === 1 ? "order" : "orders"}`}><span>{day}</span>{dayOrderCount > 0 && <span className="admin-calendar-count">{dayOrderCount}</span>}</button>;
              })}
            </div>
          </section>
          <section className="admin-selected-date checklist-selected-date" aria-live="polite" aria-labelledby="checklist-selected-date-heading">
            <div className="selected-date-heading"><div><span className="eyebrow">ORDERS FOR THIS DATE</span><h2 id="checklist-selected-date-heading">{selectedPickupDate ? formatCalendarDate(selectedPickupDate, { month: "long", day: "numeric", year: "numeric" }) : "Choose a date"}</h2></div><span className="selected-date-count">{selectedChecklistOrders.length} {selectedChecklistOrders.length === 1 ? "order" : "orders"}</span></div>
            {selectedChecklistOrders.length === 0 ? <div className="calendar-empty-state">No orders for this date.</div> : <div className="checklist-order-list">{selectedChecklistOrders.map((order) => {
              const food = foodForOrder(order);
              const description = descriptionForOrder(order);
              const expanded = Boolean(expandedChecklistOrders[order.id]);
              const checkedIndexes = new Set(order.cookedFoodIndexes ?? []);
              const checklistItemCount = food.length + (description ? 1 : 0);
              const completedItemCount = food.filter((_, index) => checkedIndexes.has(index)).length + (order.descriptionDone ? 1 : 0);
              const orderProgress = checklistItemCount > 0 ? `${completedItemCount}/${checklistItemCount} done` : "No items listed";
              return <article className="checklist-order-card" key={order.id}>
                <button type="button" className="checklist-order-toggle" aria-expanded={expanded} aria-controls={`checklist-food-${order.id}`} onClick={() => setExpandedChecklistOrders((current) => ({ ...current, [order.id]: !current[order.id] }))}>
                  <span className="checklist-order-main"><strong>{order.productName} <span>× {order.quantity}{order.kilo ? ` · ${order.kilo} kg` : ""}</span></strong><small>{order.customer} · {formatTime(order.pickupTime)}</small></span>
                  <span className="checklist-order-progress">{orderProgress}</span><ChevronDown size={18} className={expanded ? "expanded" : ""} />
                </button>
                {expanded && <div className="checklist-food-list" id={`checklist-food-${order.id}`}>
                  {!description && food.length === 0 ? <p>No checklist items were saved for this order.</p> : <>
                  {description && <label className={order.descriptionDone ? "checklist-food-item checklist-description-item done" : "checklist-food-item checklist-description-item"} key="order-description">
                    <input type="checkbox" checked={order.descriptionDone === true} disabled={updatingFoodChecklistId === order.id} onChange={() => setFoodChecklistConfirmation({ order, itemType: "description", foodIndex: -1, foodName: description, nextChecked: !order.descriptionDone })} />
                    <span>{description}</span>
                  </label>}
                  {food.map((foodName, foodIndex) => {
                    const checked = checkedIndexes.has(foodIndex);
                    return <label className={checked ? "checklist-food-item done" : "checklist-food-item"} key={`${foodName}-${foodIndex}`}>
                      <input type="checkbox" checked={checked} disabled={updatingFoodChecklistId === order.id} onChange={() => setFoodChecklistConfirmation({ order, itemType: "food", foodIndex, foodName, nextChecked: !checked })} />
                      <span>{foodName}</span>
                    </label>;
                  })}
                  </>}
                </div>}
              </article>;
            })}</div>}
          </section>
        </div>
      </section>}

      {activeTab === "users" && canManageUsers && currentUser && <section className="dashboard-section admin-section">
        <div className="dashboard-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> CKB LECHON HOUSE</span><h1>Users<span className="heading-period">.</span></h1><p>View accounts and manage admin access.</p></div></div>
        {usersLoading ? <div className="admin-empty">Loading users…</div> : users.length === 0 ? <div className="admin-empty">No user accounts found.</div> : <div className="calendar-orders-table-wrap admin-users-table-wrap"><table className="calendar-orders-table admin-users-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>{users.map((user) => <tr key={user.uid}><td>{user.name}</td><td>{user.email || "—"}</td><td><select aria-label={`Role for ${user.name}`} value={user.role} disabled={user.uid === currentUser.uid || changingRoleUid !== null} title={user.uid === currentUser.uid ? "You cannot change your own role." : undefined} onChange={(event) => void updateUserRole(user, event.target.value as ManagedUser["role"])}><option value="user">Not Admin</option><option value="admin">Admin</option></select></td></tr>)}</tbody></table></div>}
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

      {conversationOrder && currentUser && <OrderConversation key={conversationOrder.id} order={conversationOrder} user={currentUser} viewerRole={canManage ? "admin" : "customer"} onClose={() => setConversationOrder(null)} />}

      {downpaymentQrOpen && <div className="overlay qr-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDownpaymentQrOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setDownpaymentQrOpen(false); }}><section className="dialog qr-dialog" role="dialog" aria-modal="true" aria-labelledby="downpayment-qr-title" aria-describedby="downpayment-qr-description"><button className="dialog-close" autoFocus onClick={() => setDownpaymentQrOpen(false)} aria-label="Close QR code"><X size={19} /></button><div className="dialog-kicker">DOWNPAYMENT</div><h2 id="downpayment-qr-title">Scan to pay 500 pesos minimum.</h2><p id="downpayment-qr-description">Scan this QR code with your banking or payment app.</p><Image className="downpayment-qr-image" src="/downpayment-qr.jpg" alt="Downpayment QR code" width={1284} height={1930} priority /><a className="submit-button qr-save-button" href="/downpayment-qr.jpg" download="downpayment-qr.jpg"><span>Save this QR</span><Download size={17} /></a></section></div>}

      {locationMapOpen && <div className="overlay map-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLocationMapOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setLocationMapOpen(false); }}><section className="dialog map-dialog" role="dialog" aria-modal="true" aria-labelledby="location-map-title" aria-describedby="location-map-description"><button className="dialog-close" autoFocus onClick={() => setLocationMapOpen(false)} aria-label="Close location map"><X size={19} /></button><div className="dialog-kicker">CKB LECHON HOUSE</div><h2 id="location-map-title">Find us.</h2><p id="location-map-description">Located at Purok-11, Obrero, Butuan City 8600.</p><iframe className="location-map-frame" title="Map to CKB Lechon House" src="https://www.google.com/maps?q=8.964564313632456%2C125.53672241133174&z=17&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /><a className="map-external-link" href="https://www.google.com/maps?q=8.964564313632456%2C125.53672241133174" target="_blank" rel="noreferrer">Open in Google Maps <ArrowRight size={14} /></a></section></div>}

      {cancelOrderConfirmation && <div className="overlay confirmation-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCancelOrderConfirmation(null); }} onKeyDown={(event) => { if (event.key === "Escape") setCancelOrderConfirmation(null); }}><section className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-order-title" aria-describedby="cancel-order-description"><span className="confirmation-icon"><CircleAlert size={21} /></span><div className="dialog-kicker">YOUR CKB TABLE</div><h2 id="cancel-order-title">Cancel this order?</h2><p id="cancel-order-description">You’re cancelling <strong>{cancelOrderConfirmation.productName}</strong>. This can’t be undone.</p><div className="confirmation-order-summary"><span>{formatDate(cancelOrderConfirmation.pickupDate)} · {formatTime(cancelOrderConfirmation.pickupTime)}</span><strong>{peso(cancelOrderConfirmation.total)}</strong></div><div className="confirmation-actions"><button className="confirmation-keep" autoFocus onClick={() => setCancelOrderConfirmation(null)}>Keep order</button><button className="confirmation-cancel" onClick={confirmOrderCancellation} disabled={cancelingOrderId === cancelOrderConfirmation.id}>{cancelingOrderId === cancelOrderConfirmation.id ? "Cancelling…" : "Cancel order"}</button></div></section></div>}

      {orderActionConfirmation && (() => {
        const order = orders.find((item) => item.id === orderActionConfirmation.order.id) ?? orderActionConfirmation.order;
        const isPayment = orderActionConfirmation.action === "payment";
        const isConfirming = confirmingOrderActionId === order.id;
        const closeConfirmation = () => { if (!confirmingOrderActionId) setOrderActionConfirmation(null); };
        return <div className="overlay confirmation-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConfirmation(); }} onKeyDown={(event) => { if (event.key === "Escape") closeConfirmation(); }}><section className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="order-action-title" aria-describedby="order-action-description"><span className="confirmation-icon">{isPayment ? <Banknote size={21} /> : <PackageCheck size={21} />}</span><div className="dialog-kicker">ORDER CONFIRMATION</div><h2 id="order-action-title">{isPayment ? "Confirm full payment?" : "Confirm order delivery?"}</h2><p id="order-action-description">{isPayment ? <>Has <strong>{order.customer}</strong> paid the full amount for this order? Confirm only after receiving the full payment; this will clear the remaining balance.</> : <>Are you sure <strong>{order.customer}</strong> is receiving this order? Confirm once it has been handed over to the customer.</>}</p><div className="confirmation-order-summary"><span>{order.productName} · {isPayment ? "Remaining balance" : `${formatDate(order.pickupDate)} · ${formatTime(order.pickupTime)}`}</span><strong>{isPayment ? peso(orderBalance(order)) : peso(order.total)}</strong></div><div className="confirmation-actions"><button className="confirmation-keep" autoFocus onClick={closeConfirmation} disabled={Boolean(confirmingOrderActionId)}>{isPayment ? "Not yet" : "Keep pending"}</button><button className="confirmation-accept" onClick={confirmOrderAction} disabled={Boolean(confirmingOrderActionId)}>{isConfirming ? "Saving…" : isPayment ? "Confirm full payment" : "Mark delivered"}</button></div></section></div>;
      })()}

      {foodChecklistConfirmation && (() => {
        const { order, foodName, nextChecked } = foodChecklistConfirmation;
        const isSaving = updatingFoodChecklistId === order.id;
        const closeConfirmation = () => { if (!updatingFoodChecklistId) setFoodChecklistConfirmation(null); };
        return <div className="overlay confirmation-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConfirmation(); }} onKeyDown={(event) => { if (event.key === "Escape") closeConfirmation(); }}><section className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="food-checklist-confirmation-title" aria-describedby="food-checklist-confirmation-description"><span className="confirmation-icon"><ClipboardCheck size={21} /></span><div className="dialog-kicker">ORDER CHECKLIST</div><h2 id="food-checklist-confirmation-title">{nextChecked ? "Mark as done?" : "Undo done status?"}</h2><p id="food-checklist-confirmation-description">{nextChecked ? <>Confirm that <strong>{foodName}</strong> for <strong>{order.productName} × {order.quantity}</strong> is done.</> : <>Remove the done mark for <strong>{foodName}</strong> in <strong>{order.productName} × {order.quantity}</strong>?</>}</p><div className="confirmation-actions"><button className="confirmation-keep" autoFocus onClick={closeConfirmation} disabled={Boolean(updatingFoodChecklistId)}>Cancel</button><button className="confirmation-accept" onClick={confirmFoodChecklist} disabled={Boolean(updatingFoodChecklistId)}>{isSaving ? "Saving…" : nextChecked ? "Confirm done" : "Undo done"}</button></div></section></div>;
      })()}

      {productRemovalConfirmation && <div className="overlay confirmation-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !removingProductId) setProductRemovalConfirmation(null); }} onKeyDown={(event) => { if (event.key === "Escape" && !removingProductId) setProductRemovalConfirmation(null); }}><section className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-product-title" aria-describedby="remove-product-description"><span className="confirmation-icon"><CircleAlert size={21} /></span><div className="dialog-kicker">THE CKB MENU</div><h2 id="remove-product-title">Remove this menu item?</h2><p id="remove-product-description">You’re removing <strong>{productRemovalConfirmation.orderName}</strong>. Customers will no longer be able to order it. This can’t be undone.</p><div className="confirmation-actions"><button className="confirmation-keep" autoFocus onClick={() => setProductRemovalConfirmation(null)} disabled={Boolean(removingProductId)}>Keep item</button><button className="confirmation-cancel" onClick={confirmProductRemoval} disabled={Boolean(removingProductId)}>{removingProductId === productRemovalConfirmation.id ? "Removing…" : "Remove item"}</button></div></section></div>}

      {logoutConfirmationOpen && <div className="overlay confirmation-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogoutConfirmationOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setLogoutConfirmationOpen(false); }}><section className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description"><span className="confirmation-icon"><LogOut size={20} /></span><div className="dialog-kicker">CKB LECHON HOUSE</div><h2 id="logout-title">Logout Confirmation</h2><p id="logout-description">Are you sure you want to end your session?</p><div className="confirmation-actions"><button className="confirmation-keep" autoFocus onClick={() => setLogoutConfirmationOpen(false)}>Stay signed in</button><button className="confirmation-cancel" onClick={logout}>Log out</button></div></section></div>}

      {rescheduleDraft && (() => {
        const product = products.find((item) => item.id === rescheduleDraft.order.productId);
        const minDate = product?.saleType === "promo" && product.promoFrom && product.promoFrom > (today || localDateKey(new Date()))
          ? product.promoFrom
          : today || localDateKey(new Date());
        return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !reschedulingOrderId) setRescheduleDraft(null); }} onKeyDown={(event) => { if (event.key === "Escape" && !reschedulingOrderId) setRescheduleDraft(null); }}><section className="dialog product-dialog reschedule-dialog" role="dialog" aria-modal="true" aria-labelledby="reschedule-order-title"><button className="dialog-close" onClick={() => setRescheduleDraft(null)} aria-label="Close reschedule form" disabled={Boolean(reschedulingOrderId)}><X size={19} /></button><div className="dialog-kicker">PICKUP CALENDAR</div><h2 id="reschedule-order-title">Reschedule pickup.</h2><p className="reschedule-order-summary">{rescheduleDraft.order.customer} · {rescheduleDraft.order.productName}</p><form className="auth-form" onSubmit={saveOrderReschedule}><div className="pickup-fields"><label>Pickup date<input required type="date" min={minDate} max={product?.saleType === "promo" ? product.promoTo : undefined} value={rescheduleDraft.pickupDate} onChange={(event) => setRescheduleDraft({ ...rescheduleDraft, pickupDate: event.target.value })} /></label><label>Pickup time<input required type="time" value={rescheduleDraft.pickupTime} onChange={(event) => setRescheduleDraft({ ...rescheduleDraft, pickupTime: event.target.value })} /></label></div>{product?.saleType === "promo" && <div className="pickup-note">Promo pickup dates: {formatDate(product.promoFrom ?? "")} – {formatDate(product.promoTo ?? "")}.</div>}<div className="confirmation-actions"><button type="button" className="confirmation-keep" onClick={() => setRescheduleDraft(null)} disabled={Boolean(reschedulingOrderId)}>Cancel</button><button className="confirmation-accept" disabled={Boolean(reschedulingOrderId)}>{reschedulingOrderId ? "Saving…" : "Save new pickup"}</button></div></form></section></div>;
      })()}

      {selectedOrderProduct && <div className="overlay menu-item-preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOrderProduct(null); }}>
        <section className="dialog menu-item-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="menu-item-preview-title" aria-describedby="menu-item-preview-description" onKeyDown={(event) => { if (event.key === "Escape") setSelectedOrderProduct(null); }}>
          <button className="dialog-close" autoFocus onClick={() => setSelectedOrderProduct(null)} aria-label="Close menu item details"><X size={19} /></button>
          <div className="menu-item-preview-photo" style={{ backgroundImage: selectedOrderProduct.imageUrl ? `url("${selectedOrderProduct.imageUrl}")` : undefined }}>
            <span className={selectedOrderProduct.saleType === "promo" ? "product-tag promo-tag" : "product-tag"}>{selectedOrderProduct.saleType === "promo" ? <><Flame size={12} /> SPECIAL</> : "HOUSE FAVORITE"}</span>
          </div>
          <div className="menu-item-preview-copy">
            <div className="menu-item-preview-title"><h2 id="menu-item-preview-title">{selectedOrderProduct.orderName}</h2><strong>{productPriceLabel(selectedOrderProduct)}</strong></div>
            {supportsStock(selectedOrderProduct.orderName) && <strong className="product-stock">Stock: {typeof selectedOrderProduct.stock === "number" ? selectedOrderProduct.stock : "Not set"}</strong>}
            {selectedOrderProduct.food && selectedOrderProduct.food.length > 0 && <div className="product-food-tags" aria-label="Food included">{selectedOrderProduct.food.map((food, foodIndex) => <span className="product-food-tag" key={`${food}-${foodIndex}`}>{food}</span>)}</div>}
            <p id="menu-item-preview-description">{selectedOrderProduct.description || "Menu details are no longer available."}</p>
            {selectedOrderProduct.saleType === "promo" && selectedOrderProduct.promoTo && <small className="promo-date">Promo through {formatDate(selectedOrderProduct.promoTo)}</small>}
          </div>
        </section>
      </div>}
      {orderProduct && (
        <div className="overlay order-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrderProduct(null); }}>
          <section className="dialog order-dialog" role="dialog" aria-modal="true" aria-labelledby="pickup-title">
            <button className="dialog-close" onClick={() => setOrderProduct(null)} aria-label="Close"><X size={19} /></button>
            <div className="order-dialog-photo" style={{ backgroundImage: `url("${orderProduct.imageUrl}")` }} />
            <div className="order-mobile-heading" aria-hidden="true"><div>MAKE IT A GATHERING</div><h2>Save your spot.</h2></div>
            <div className="dialog-kicker">PLACE AN ORDER</div>
            <h2 id="pickup-title">{orderProduct.name}</h2>
            <p className="order-description">{orderProduct.description}</p>
            <p className="order-summary"><span>Order total</span><strong>{peso(orderTotal)}</strong></p>
            <p className="order-mobile-summary"><strong>{orderProduct.name}</strong><span>{peso(orderTotal)}</span></p>
            <form className="auth-form" onSubmit={requestOrderPolicyConfirmation}>
              {orderProduct.orderName === "Whole Lechon" && <label>Kilo<select required value={orderKilo} onChange={(event) => setOrderKilo(event.target.value)}><option value="">Choose kilo</option>{orderKiloOptions.map(({ kilo, price }) => <option key={kilo} value={kilo}>{kilo} kg · {peso(price)}</option>)}</select></label>}
              <label>Quantity{allowsDecimalQuantity(orderProduct.orderName) && " (decimal amounts allowed)"}<input type="number" min={allowsDecimalQuantity(orderProduct.orderName) ? 0.01 : 1} max={allowsDecimalQuantity(orderProduct.orderName) && typeof orderProduct.stock === "number" ? Math.min(99, orderProduct.stock) : 99} step={allowsDecimalQuantity(orderProduct.orderName) ? "any" : 1} required value={orderQuantity} onChange={(event) => setOrderQuantity(event.target.value)} /></label>
              <div className="pickup-fields"><label>Pickup date<input required type="date" min={orderProduct.saleType === "promo" && orderProduct.promoFrom && orderProduct.promoFrom > today ? orderProduct.promoFrom : today} max={orderProduct.saleType === "promo" ? orderProduct.promoTo : undefined} value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} /></label><label>Pickup time<input required type="time" value={pickupTime} onChange={(event) => setPickupTime(event.target.value)} /></label></div>
              {orderProduct.saleType === "promo" && <div className="pickup-note">Promo pickup dates: {formatDate(orderProduct.promoFrom ?? "")} – {formatDate(orderProduct.promoTo ?? "")}.</div>}
              {!signedIn && <div className="pickup-note">Sign in or try a preview to confirm your pickup.</div>}
              <button className="submit-button" disabled={busy || !isPickupDateEligible(orderProduct, pickupDate) || (orderProduct.orderName === "Whole Lechon" && !orderKiloOptions.some((option) => option.kilo === orderKilo))}>{busy ? "Saving your pickup..." : "Confirm pickup"}<ArrowRight size={16} /></button>
            </form>
          </section>
        </div>
      )}

      {orderPolicyConfirmationOpen && orderProduct && <div className="overlay confirmation-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOrderPolicyConfirmationOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape" && !busy) setOrderPolicyConfirmationOpen(false); }}><section className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="order-policy-title" aria-describedby="order-policy-description"><span className="confirmation-icon"><CircleHelp size={21} /></span><div className="dialog-kicker">ORDERING POLICIES</div><h2 id="order-policy-title">Before you place your order.</h2><p id="order-policy-description">Please prepare the downpayment for your order. Downpayments are non-refundable once paid. You may reschedule, subject to stock availability. By selecting “I agree and place order,” you confirm that you have read and agree to these ordering policies.</p><div className="confirmation-actions"><button className="confirmation-keep" autoFocus onClick={() => setOrderPolicyConfirmationOpen(false)} disabled={busy}>Cancel</button><button className="confirmation-accept" onClick={confirmOrderPolicy} disabled={busy}>{busy ? "Placing order…" : "I agree and place order"}</button></div></section></div>}

      {productDraft && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setProductDraft(null); setEditingProduct(null); } }}>
          <section className="dialog product-dialog" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
            <button className="dialog-close" onClick={() => { setProductDraft(null); setEditingProduct(null); }} aria-label="Close"><X size={19} /></button>
            <div className="dialog-kicker">THE CKB MENU</div>
            <h2 id="product-form-title">{editingProduct ? "Edit menu item." : "Add something good."}</h2>
            <form className="auth-form" onSubmit={saveProduct}>
              <label>Order name<select required value={productDraft.orderName} onChange={(event) => { const orderName = event.target.value as OrderName; setProductDraft({ ...productDraft, orderName, name: orderName }); }}>{orderNames.map((orderName) => <option key={orderName} value={orderName}>{orderName}</option>)}</select></label>
              <label>Description<textarea required rows={3} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} /></label>
              <label>Food<textarea rows={2} placeholder="Separate multiple foods with commas" value={foodInput} onChange={(event) => setFoodInput(event.target.value)} /></label>
              {supportsStock(productDraft.orderName) && <label>Stock<input type="number" min="0" step="any" placeholder="Available stock" value={productDraft.stock ?? ""} onChange={(event) => setProductDraft({ ...productDraft, stock: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>}
              {productDraft.orderName === "Whole Lechon" ? (
                <div className="kilo-pricing-editor">
                  <strong>Kilo and price options</strong>
                  {kiloPriceRows.map((row, index) => <div className="kilo-price-row" key={`kilo-price-${index}`}>
                    <label>Kilo<input type="number" min="0.01" step="any" required value={row.kilo || ""} onChange={(event) => { const kilo = event.target.value === "" ? 0 : Number(event.target.value); setKiloPriceRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, kilo } : item)); }} /></label>
                    <label>Price (₱)<input type="number" min="0" step="0.01" required value={row.price} onChange={(event) => { const price = event.target.value === "" ? 0 : Number(event.target.value); setKiloPriceRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, price } : item)); }} /></label>
                    <button type="button" className="remove-kilo-price" aria-label={`Remove kilo option ${index + 1}`} onClick={() => setKiloPriceRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button>
                  </div>)}
                  <button type="button" className="add-kilo-price" onClick={() => setKiloPriceRows((current) => [...current, { kilo: 0, price: 0 }])}><Plus size={15} /> Add kilo price</button>
                  <p className="pickup-note">Add one or more kilo and price options. Customers choose a kilo before ordering.</p>
                </div>
              ) : <label>Price (₱)<input type="number" required min="0" step="0.01" value={productDraft.price || ""} onChange={(event) => setProductDraft({ ...productDraft, price: Number(event.target.value) })} /></label>}
              <label>Sale type<select value={productDraft.saleType} onChange={(event) => setProductDraft({ ...productDraft, saleType: event.target.value as Product["saleType"] })}><option value="regular">Regular</option><option value="promo">Promo</option></select></label>
              {productDraft.saleType === "promo" && <div className="name-fields"><label>Date From<input required type="date" max={productDraft.promoTo || undefined} value={productDraft.promoFrom || ""} onChange={(event) => setProductDraft({ ...productDraft, promoFrom: event.target.value })} /></label><label>Date To<input required type="date" min={productDraft.promoFrom || undefined} value={productDraft.promoTo || ""} onChange={(event) => setProductDraft({ ...productDraft, promoTo: event.target.value })} /></label></div>}
              <label>Upload image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /></label>
              {!uploadThingConfigured && !demoMode && <div className="pickup-note">Configure the UploadThing Worker URL to enable image uploads.</div>}
              <button className="submit-button" disabled={busy}>{busy ? uploadingImage ? "Uploading image..." : "Saving..." : editingProduct ? "Save changes" : "Add to menu"}<ArrowRight size={16} /></button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
