// Codemod: rewrite `import { Foo, Bar } from "lucide-react"` to Tabler
// using `as` aliases so JSX call sites stay unchanged. Skips files whose
// imports include any name not in the mapping (logged for manual review).

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const ROOT = process.cwd();

const MAP = {
  ChevronDown: "IconChevronDown",
  ChevronRight: "IconChevronRight",
  ChevronLeft: "IconChevronLeft",
  ChevronUp: "IconChevronUp",
  ChevronsLeft: "IconChevronsLeft",
  ChevronsRight: "IconChevronsRight",
  ChevronsUpDown: "IconArrowsUpDown",
  Plus: "IconPlus",
  PlusCircle: "IconCirclePlus",
  PlusSquare: "IconSquarePlus",
  Minus: "IconMinus",
  MinusCircle: "IconCircleMinus",
  X: "IconX",
  XCircle: "IconCircleX",
  Check: "IconCheck",
  CheckCircle: "IconCircleCheck",
  CheckCircle2: "IconCircleCheckFilled",
  CheckSquare: "IconSquareCheck",
  Search: "IconSearch",
  Trash: "IconTrash",
  Trash2: "IconTrash",
  Pencil: "IconPencil",
  Edit: "IconPencil",
  Edit2: "IconPencil",
  Edit3: "IconPencil",
  Save: "IconDeviceFloppy",
  Eye: "IconEye",
  EyeOff: "IconEyeOff",
  AlertTriangle: "IconAlertTriangle",
  AlertCircle: "IconAlertCircle",
  AlertOctagon: "IconAlertOctagon",
  Info: "IconInfoCircle",
  Calendar: "IconCalendar",
  CalendarDays: "IconCalendarEvent",
  CalendarClock: "IconCalendarTime",
  Clock: "IconClock",
  Filter: "IconFilter",
  SlidersHorizontal: "IconAdjustmentsHorizontal",
  Sliders: "IconAdjustments",
  Settings: "IconSettings",
  Settings2: "IconAdjustments",
  Package: "IconPackage",
  Package2: "IconPackage",
  PackagePlus: "IconPackages",
  ShoppingCart: "IconShoppingCart",
  ShoppingBag: "IconShoppingBag",
  Star: "IconStar",
  StarOff: "IconStarOff",
  Heart: "IconHeart",
  Loader2: "IconLoader2",
  Loader: "IconLoader",
  ArrowLeft: "IconArrowLeft",
  ArrowRight: "IconArrowRight",
  ArrowUp: "IconArrowUp",
  ArrowDown: "IconArrowDown",
  ArrowUpRight: "IconArrowUpRight",
  ArrowDownLeft: "IconArrowDownLeft",
  ArrowUpDown: "IconArrowsUpDown",
  ArrowLeftRight: "IconArrowsLeftRight",
  Copy: "IconCopy",
  Download: "IconDownload",
  Upload: "IconUpload",
  FileText: "IconFileText",
  File: "IconFile",
  FileUp: "IconFileUpload",
  FileDown: "IconFileDownload",
  FilePlus: "IconFilePlus",
  FileX: "IconFileX",
  Files: "IconFiles",
  Folder: "IconFolder",
  FolderPlus: "IconFolderPlus",
  Image: "IconPhoto",
  ImageOff: "IconPhotoOff",
  Link: "IconLink",
  Link2: "IconLink",
  ExternalLink: "IconExternalLink",
  Unlink: "IconUnlink",
  Unlink2: "IconUnlink",
  Menu: "IconMenu2",
  MoreHorizontal: "IconDots",
  MoreVertical: "IconDotsVertical",
  Refresh: "IconRefresh",
  RefreshCw: "IconRefresh",
  RefreshCcw: "IconRefresh",
  RotateCw: "IconRotateClockwise",
  RotateCcw: "IconRotate",
  Bell: "IconBell",
  BellOff: "IconBellOff",
  User: "IconUser",
  UserPlus: "IconUserPlus",
  Users: "IconUsers",
  LogIn: "IconLogin",
  LogOut: "IconLogout",
  Send: "IconSend",
  Mail: "IconMail",
  Phone: "IconPhone",
  MapPin: "IconMapPin",
  Map: "IconMap",
  Tag: "IconTag",
  Tags: "IconTags",
  Lock: "IconLock",
  Unlock: "IconLockOpen",
  Home: "IconHome",
  Truck: "IconTruck",
  Box: "IconBox",
  Boxes: "IconBoxMultiple",
  DollarSign: "IconCurrencyDollar",
  Euro: "IconCurrencyEuro",
  Percent: "IconPercentage",
  Hash: "IconHash",
  AtSign: "IconAt",
  Globe: "IconWorld",
  Database: "IconDatabase",
  Server: "IconServer",
  Wrench: "IconTool",
  Hammer: "IconHammer",
  Activity: "IconActivity",
  Zap: "IconBolt",
  Sun: "IconSun",
  Moon: "IconMoon",
  Coffee: "IconCoffee",
  Camera: "IconCamera",
  Video: "IconVideo",
  Music: "IconMusic",
  Mic: "IconMicrophone",
  MicOff: "IconMicrophoneOff",
  Play: "IconPlayerPlay",
  Pause: "IconPlayerPause",
  SkipBack: "IconPlayerSkipBack",
  SkipForward: "IconPlayerSkipForward",
  Repeat: "IconRepeat",
  Shuffle: "IconArrowsShuffle",
  Volume: "IconVolume",
  Volume2: "IconVolume",
  VolumeX: "IconVolumeOff",
  Pin: "IconPin",
  Bookmark: "IconBookmark",
  Layers: "IconStack",
  Grid: "IconGrid3x3",
  Grid3x3: "IconGrid3x3",
  Grid2x2: "IconGrid4x4",
  List: "IconList",
  ListChecks: "IconListCheck",
  ListPlus: "IconListNumbers",
  ListOrdered: "IconListNumbers",
  Square: "IconSquare",
  Circle: "IconCircle",
  Triangle: "IconTriangle",
  Smile: "IconMoodHappy",
  Frown: "IconMoodSad",
  Maximize: "IconMaximize",
  Maximize2: "IconMaximize",
  Minimize: "IconMinimize",
  Minimize2: "IconMinimize",
  FlaskConical: "IconFlask",
  Beaker: "IconBeaker",
  Scale: "IconScale",
  Type: "IconTypography",
  Bold: "IconBold",
  Italic: "IconItalic",
  Underline: "IconUnderline",
  Layout: "IconLayout",
  PanelLeft: "IconLayoutSidebar",
  PanelRight: "IconLayoutSidebarRight",
  Sidebar: "IconLayoutSidebar",
  ArrowRightCircle: "IconCircleArrowRight",
  ArrowLeftCircle: "IconCircleArrowLeft",
  Move: "IconArrowsMove",
  GripVertical: "IconGripVertical",
  GripHorizontal: "IconGripHorizontal",
  HelpCircle: "IconHelp",
  CircleHelp: "IconHelp",
  History: "IconHistory",
  RotateCw2: "IconRotateClockwise",
  Undo: "IconArrowBackUp",
  Undo2: "IconArrowBackUp",
  Redo: "IconArrowForwardUp",
  Redo2: "IconArrowForwardUp",
  Snowflake: "IconSnowflake",
  Flame: "IconFlame",
  Droplet: "IconDroplet",
  Droplets: "IconDroplets",
  Cookie: "IconCookie",
  Cake: "IconCake",
  IceCream: "IconIceCream",
  Wine: "IconGlassFull",
  Beef: "IconMeat",
  Egg: "IconEgg",
  Wheat: "IconWheat",
  Leaf: "IconLeaf",
  Sprout: "IconPlant2",
  Apple: "IconApple",
  Carrot: "IconCarrot",
  Banana: "IconBolt", // closest fallback — Tabler has no banana icon
  Fish: "IconFish",
  ChefHat: "IconChefHat",
  Utensils: "IconToolsKitchen",
  UtensilsCrossed: "IconToolsKitchen2",
  Soup: "IconBowl",
  Receipt: "IconReceipt",
  Briefcase: "IconBriefcase",
  Building: "IconBuilding",
  Building2: "IconBuildingSkyscraper",
  Factory: "IconBuildingFactory",
  Warehouse: "IconBuildingWarehouse",
  ClipboardList: "IconClipboardList",
  Clipboard: "IconClipboard",
  ClipboardCheck: "IconClipboardCheck",
  BookOpen: "IconBookmark", // fallback
  Book: "IconBook",
  Notebook: "IconNotebook",
  Notes: "IconNote",
  StickyNote: "IconNote",
  CircleAlert: "IconAlertCircle",
  CircleCheck: "IconCircleCheck",
  TriangleAlert: "IconAlertTriangle",
  CircleDot: "IconCircleDot",
  Dot: "IconPointFilled",
  EllipsisVertical: "IconDotsVertical",
  EllipsisHorizontal: "IconDots",
  Ellipsis: "IconDots",
  ShieldAlert: "IconShieldExclamation",
  Shield: "IconShield",
  Award: "IconAward",
  Bookmark2: "IconBookmark",
  TrendingUp: "IconTrendingUp",
  TrendingDown: "IconTrendingDown",
  BarChart: "IconChartBar",
  BarChart2: "IconChartBar",
  BarChart3: "IconChartBar",
  PieChart: "IconChartPie",
  LineChart: "IconChartLine",
  PencilLine: "IconPencil",
  PencilOff: "IconPencilOff",
  PlayCircle: "IconPlayerPlay",
  Archive: "IconArchive",
  ArchiveRestore: "IconArchiveOff",
  LockOpen: "IconLockOpen",
  GitBranch: "IconGitBranch",
  FileWarning: "IconFileAlert",
  Wand2: "IconWand",
  Wand: "IconWand",
  Thermometer: "IconTemperature",
  Printer: "IconPrinter",
  PackageX: "IconPackageOff",
  FileSpreadsheet: "IconFileSpreadsheet",
};

function rewriteImportLine(line) {
  // Match named imports only; skip default or namespace imports.
  const re = /^(\s*)import\s+\{([^}]+)\}\s+from\s+["']lucide-react["'];?(\s*)$/;
  const m = line.match(re);
  if (!m) return null;
  const indent = m[1];
  const trailing = m[3] ?? "";
  const namesRaw = m[2].split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = [];
  const rebuilt = [];
  for (const item of namesRaw) {
    // Already-aliased imports (e.g. `Foo as Bar`) — preserve alias.
    const aliasMatch = item.match(/^(\w+)\s+as\s+(\w+)$/);
    if (aliasMatch) {
      const orig = aliasMatch[1];
      const alias = aliasMatch[2];
      const tabler = MAP[orig];
      if (!tabler) {
        unknown.push(orig);
        continue;
      }
      rebuilt.push(`${tabler} as ${alias}`);
    } else {
      const tabler = MAP[item];
      if (!tabler) {
        unknown.push(item);
        continue;
      }
      rebuilt.push(`${tabler} as ${item}`);
    }
  }
  if (unknown.length > 0) return { skipped: true, unknown };
  return {
    skipped: false,
    line: `${indent}import { ${rebuilt.join(", ")} } from "@tabler/icons-react";${trailing}`,
  };
}

async function processFile(path) {
  const original = await readFile(path, "utf8");
  if (!original.includes("lucide-react")) return null;
  const lines = original.split(/\r?\n/);
  const newLines = [];
  let changed = false;
  let unknownAll = [];
  for (const line of lines) {
    const out = rewriteImportLine(line);
    if (out == null) {
      newLines.push(line);
    } else if (out.skipped) {
      unknownAll.push(...out.unknown);
      newLines.push(line);
    } else {
      newLines.push(out.line);
      changed = true;
    }
  }
  if (unknownAll.length > 0) {
    return { path, unknown: [...new Set(unknownAll)], changed: false };
  }
  if (changed) {
    await writeFile(path, newLines.join("\n"), "utf8");
    return { path, changed: true };
  }
  return null;
}

const files = globSync(["src/**/*.{ts,tsx}"], { cwd: ROOT, absolute: true });
const results = [];
for (const f of files) {
  const r = await processFile(f);
  if (r) results.push(r);
}

const changed = results.filter((r) => r.changed);
const skipped = results.filter((r) => !r.changed);
console.log(`Rewrote ${changed.length} files.`);
for (const c of changed) console.log("  " + c.path);
if (skipped.length > 0) {
  console.log(`\nSkipped ${skipped.length} files (unknown imports):`);
  for (const s of skipped) {
    console.log(`  ${s.path} — missing: ${s.unknown.join(", ")}`);
  }
}
