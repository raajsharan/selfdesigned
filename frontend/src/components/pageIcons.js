import { DatabaseOutlined, CloudOutlined, GlobalOutlined, HddOutlined, ClusterOutlined, ToolOutlined, AppstoreOutlined, TeamOutlined, SafetyCertificateOutlined,
  LaptopOutlined, CloudServerOutlined, ApartmentOutlined, WifiOutlined, PrinterOutlined, ApiOutlined, FolderOutlined, TagOutlined, BankOutlined, BugOutlined, StarOutlined } from '@ant-design/icons';

// Names must match ICONS in backend/src/services/pageService.js
export const PAGE_ICONS = { database: DatabaseOutlined, cloud: CloudOutlined, global: GlobalOutlined, hdd: HddOutlined, cluster: ClusterOutlined, tool: ToolOutlined,
  appstore: AppstoreOutlined, team: TeamOutlined, safety: SafetyCertificateOutlined, laptop: LaptopOutlined, cloudserver: CloudServerOutlined, apartment: ApartmentOutlined,
  wifi: WifiOutlined, printer: PrinterOutlined, api: ApiOutlined, folder: FolderOutlined, tag: TagOutlined, bank: BankOutlined, bug: BugOutlined, star: StarOutlined };
export const iconFor = (name) => PAGE_ICONS[name] || DatabaseOutlined;
