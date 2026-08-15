import { useMemo, useState } from "react";
import {
  ChevronRight,
  CircleSlash,
  Clock3,
  Folder,
  FolderTree,
  Hash,
  Heart,
  Layers,
  Library,
  Plus,
  Repeat2,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SwatchBook as Swatches,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { count } from "@/lib/format";
import { useUi } from "@/store/ui";
import { useBrands, useCollections, useFolders, useProjects, useStats, useTags } from "@/hooks/queries";
import { Tooltip } from "@/components/ui/misc";

interface Props {
  onNewCollection: () => void;
  onNewBrand: () => void;
  onManageTags: () => void;
}

export function Sidebar({ onNewCollection, onNewBrand, onManageTags }: Props) {
  const { view, setView, setSettingsOpen } = useUi();
  const stats = useStats(true);
  const tags = useTags(true);
  const collections = useCollections(true);
  const projects = useProjects(true);
  const folders = useFolders(true);
  const brands = useBrands(true);

  const s = stats.data;

  const folderTree = useMemo(() => buildFolderTree(folders.data ?? []), [folders.data]);

  return (
    <nav
      className="flex h-full flex-col overflow-y-auto overflow-x-hidden bg-sidebar hairline-r"
      aria-label="Library navigation"
    >
      <div className="drag-region h-10 shrink-0" />

      <div className="flex flex-col gap-0.5 px-2 pb-2">
        <Row
          active={view.kind === "all"}
          onClick={() => setView({ kind: "all" })}
          icon={<Library />}
          label="Library"
          badge={s?.total}
        />
        <Row
          active={view.kind === "unused"}
          onClick={() => setView({ kind: "unused" })}
          icon={<Sparkles />}
          label="Never Used"
          badge={s?.unused}
        />
        <Row
          active={view.kind === "used"}
          onClick={() => setView({ kind: "used" })}
          icon={<CircleSlash />}
          label="Used"
          badge={s?.used}
        />
        <Row
          active={view.kind === "recentlyUsed"}
          onClick={() => setView({ kind: "recentlyUsed" })}
          icon={<Clock3 />}
          label="Recently Used"
        />
        <Row
          active={view.kind === "mostUsed"}
          onClick={() => setView({ kind: "mostUsed" })}
          icon={<Repeat2 />}
          label="Most Used"
        />
        <Row
          active={view.kind === "favorites"}
          onClick={() => setView({ kind: "favorites" })}
          icon={<Heart />}
          label="Favorites"
          badge={s?.favorites}
        />
        {!!s?.missing && (
          <Row
            active={view.kind === "missing"}
            onClick={() => setView({ kind: "missing" })}
            icon={<TriangleAlert />}
            label="Needs attention"
            badge={s.missing}
            tone="warn"
          />
        )}
        <Row
          active={view.kind === "sourceFolders" || view.kind === "folder"}
          onClick={() => setView({ kind: "sourceFolders" })}
          icon={<FolderTree />}
          label="Source Folders"
          badge={folderTree.length}
        />
      </div>

      <Section
        title="Brands"
        action={{ label: "New brand", onClick: onNewBrand, icon: <Plus /> }}
        empty={brands.data?.length === 0 ? "No brands yet" : undefined}
      >
        {brands.data?.map((b) => (
          <Row
            key={b.id}
            active={view.kind === "brand" && view.id === b.id}
            onClick={() => setView({ kind: "brand", id: b.id, name: b.name })}
            icon={<Swatches />}
            label={b.name}
          />
        ))}
      </Section>

      <Section
        title="Collections"
        action={{ label: "New collection", onClick: onNewCollection, icon: <Plus /> }}
        empty={collections.data?.length === 0 ? "No collections yet" : undefined}
      >
        {collections.data?.map((c) => (
          <Row
            key={c.id}
            active={view.kind === "collection" && view.id === c.id}
            onClick={() => setView({ kind: "collection", id: c.id, name: c.name })}
            icon={<Layers />}
            label={c.name}
            badge={c.footageCount}
          />
        ))}
      </Section>

      {!!projects.data?.length && (
        <Section title="Projects">
          {projects.data.map((p) => (
            <Row
              key={p.id}
              active={view.kind === "project" && view.id === p.id}
              onClick={() => setView({ kind: "project", id: p.id, name: p.name })}
              icon={<Folder />}
              label={p.name}
              badge={p.footageCount}
            />
          ))}
        </Section>
      )}

      {!!tags.data?.length && (
        <Section
          title="Tags"
          action={{ label: "Manage tags", onClick: onManageTags, icon: <SlidersHorizontal /> }}
        >
          {tags.data.slice(0, 40).map((t) => (
            <Row
              key={t.id}
              active={view.kind === "tag" && view.name === t.name}
              onClick={() => setView({ kind: "tag", name: t.name })}
              icon={<Hash />}
              label={t.name}
              badge={t.footageCount}
            />
          ))}
        </Section>
      )}

      <div className="flex-1 shrink-0 min-h-4" />
      <div className="px-2 pb-2">
        <Row
          active={false}
          onClick={() => setSettingsOpen(true)}
          icon={<Settings />}
          label="Settings"
        />
      </div>
    </nav>
  );
}

function Section({
  title,
  children,
  action,
  empty,
}: {
  title: string;
  children?: React.ReactNode;
  action?: { label: string; onClick: () => void; icon: React.ReactNode };
  empty?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-1 px-2">
      <div className="group flex items-center gap-1 px-1.5 py-1">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-1 rounded text-[11px] font-medium uppercase
                     tracking-wide text-subtle-foreground outline-none transition-colors
                     hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight
            className={cn("size-3 transition-transform", open && "rotate-90")}
          />
          {title}
        </button>
        {action && (
          <Tooltip content={action.label}>
            <button
              aria-label={action.label}
              onClick={action.onClick}
              className="rounded p-0.5 text-subtle-foreground opacity-0 transition-opacity
                         hover:bg-accent hover:text-foreground group-hover:opacity-100
                         focus-visible:opacity-100 [&_svg]:size-3"
            >
              {action.icon}
            </button>
          </Tooltip>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-px">
          {children}
          {empty && (
            <p className="px-2 py-1 text-[11.5px] text-subtle-foreground">{empty}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  active,
  onClick,
  icon,
  label,
  badge,
  tone,
  style,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  tone?: "warn";
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={style}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[26px] w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px]",
        "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        active
          ? "bg-accent font-medium text-foreground [&_svg]:text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground [&_svg]:text-subtle-foreground",
        tone === "warn" && "[&_svg]:text-warning",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className="tnum shrink-0 text-[11px] text-subtle-foreground">
          {count(badge)}
        </span>
      )}
    </button>
  );
}

// ── source folder tree ──────────────────────────────────────────────────────

interface FolderTreeNode {
  path: string;
  name: string;
  total: number;
  used: number;
  unused: number;
  tags: string[];
  fields: import("@/lib/types").FolderFieldValue[];
  children: FolderTreeNode[];
}

/**
 * Rebuilds the original Drive hierarchy from the flat `container_path` values
 * stored at import time (§6). Counts roll up, so a parent shows the size of its
 * whole subtree — matching what clicking it will actually show.
 */
function buildFolderTree(rows: import("@/lib/types").FolderNode[]) {
  const roots: FolderTreeNode[] = [];
  const index = new Map<string, FolderTreeNode>();

  const ensure = (path: string): FolderTreeNode => {
    const existing = index.get(path);
    if (existing) return existing;

    const cut = path.lastIndexOf("/");
    const name = cut === -1 ? path : path.slice(cut + 1);
    const node: FolderTreeNode = { path, name, total: 0, used: 0, unused: 0, tags: [], fields: [], children: [] };
    index.set(path, node);

    if (cut === -1) roots.push(node);
    else ensure(path.slice(0, cut)).children.push(node);

    return node;
  };

  for (const r of rows) {
    const node = ensure(r.containerPath);
    node.total += r.footageCount;
    node.used += r.usedCount;
    node.unused += r.unusedCount;
    node.tags = r.tags;
    node.fields = r.fields;
    // Roll the count up every ancestor.
    let cut = r.containerPath.lastIndexOf("/");
    while (cut !== -1) {
      const parentPath = r.containerPath.slice(0, cut);
      ensure(parentPath).total += r.footageCount;
      ensure(parentPath).used += r.usedCount;
      ensure(parentPath).unused += r.unusedCount;
      cut = parentPath.lastIndexOf("/");
    }
  }

  const sort = (nodes: FolderTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
