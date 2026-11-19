import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit2,
  Globe,
  Image as ImageIcon,
  Inbox,
  Newspaper,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
  ExternalLink,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  ClassItem,
  SchoolAdmissionInquiry,
  SchoolCalendarEvent,
  SchoolWebsiteGalleryItem,
  SchoolWebsitePost,
  SchoolWebsiteProfile,
  SchoolWebsiteUrls,
  TimetableSlotItem,
  WebsiteThemeAccent,
} from '../../types/index.js';
import { compressImageFileToDataUrl } from '../../utils/imageUpload.js';
import { copyTextToClipboard } from '../../utils/clipboard.js';

type ManagerTab = 'branding' | 'posts' | 'gallery' | 'events' | 'timetable' | 'inquiries';

const THEME_ACCENT_OPTIONS: Array<{ value: WebsiteThemeAccent; label: string; swatch: string }> = [
  { value: 'emerald', label: 'Emerald Heritage', swatch: 'bg-emerald-600' },
  { value: 'navy', label: 'Royal Navy', swatch: 'bg-blue-800' },
  { value: 'indigo', label: 'Academic Indigo', swatch: 'bg-indigo-600' },
  { value: 'burgundy', label: 'Varsity Burgundy', swatch: 'bg-rose-700' },
  { value: 'teal', label: 'Atlantic Teal', swatch: 'bg-teal-600' },
];

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface SchoolWebsiteManagerViewProps {
  onPreviewLiveWebsite?: (slug: string) => void;
}

export const SchoolWebsiteManagerView: React.FC<SchoolWebsiteManagerViewProps> = ({ onPreviewLiveWebsite }) => {
  const { activeSchool, refreshMe } = useAuth();
  const [tab, setTab] = useState<ManagerTab>('branding');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Domain entities
  const [urls, setUrls] = useState<SchoolWebsiteUrls | null>(null);
  const [subdomainInput, setSubdomainInput] = useState('');
  const [profileForm, setProfileForm] = useState<Partial<SchoolWebsiteProfile>>({
    theme_accent: 'emerald',
    admissions_open: 1,
    is_published: 1,
  });

  const [posts, setPosts] = useState<SchoolWebsitePost[]>([]);
  const [gallery, setGallery] = useState<SchoolWebsiteGalleryItem[]>([]);
  const [events, setEvents] = useState<SchoolCalendarEvent[]>([]);
  const [slots, setSlots] = useState<TimetableSlotItem[]>([]);
  const [inquiries, setInquiries] = useState<SchoolAdmissionInquiry[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);

  // Post Editor Modal
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<SchoolWebsitePost | null>(null);
  const [postForm, setPostForm] = useState({
    title: '',
    category: 'News',
    excerpt: '',
    content: '',
    cover_image_url: '',
    author_name: '',
    author_role: 'School Administration',
    is_published: true,
    is_featured: false,
  });

  // Gallery Add Form
  const [galleryForm, setGalleryForm] = useState({
    title: '',
    album: 'Campus Life',
    caption: '',
    image_url: '',
  });

  // Event Add Form
  const [eventForm, setEventForm] = useState({
    title: '',
    event_date: '',
    end_date: '',
    location: '',
    description: '',
    visibility: 'PUBLIC' as 'PUBLIC' | 'STAFF_ONLY',
  });

  // Timetable Add Form
  const [slotForm, setSlotForm] = useState({
    class_id: '',
    class_name: '',
    arm_name: '',
    day_of_week: 'Monday',
    period_label: 'Period 1',
    start_time: '08:00',
    end_time: '08:40',
    subject_name: '',
    teacher_name: '',
    room_label: '',
  });

  // Inquiry note draft cache
  const [inquiryNotes, setInquiryNotes] = useState<Record<string, string>>({});

  const loadAll = async () => {
    setLoading(true);
    try {
      const [profRes, postsRes, galRes, evRes, ttRes, inqRes, clsRes] = await Promise.all([
        api.getSchoolWebsiteAdminProfile(),
        api.getWebsitePosts(),
        api.getWebsiteGallery(),
        api.getWebsiteEvents(),
        api.getAdminTimetable(),
        api.getAdmissionInquiries(),
        api.getSchoolClasses().catch(() => ({ classes: [] })),
      ]);

      setUrls(profRes.urls);
      setSubdomainInput(profRes.urls?.portal_subdomain || '');
      setProfileForm(profRes.website || { theme_accent: 'emerald', admissions_open: 1, is_published: 1 });
      setPosts(postsRes.posts || []);
      setGallery(galRes.gallery || []);
      setEvents(evRes.events || []);
      setSlots(ttRes.slots || []);
      setInquiries(inqRes.inquiries || []);
      setClasses(clsRes.classes || []);

      const notesMap: Record<string, string> = {};
      for (const item of inqRes.inquiries || []) {
        notesMap[item.id] = item.admin_notes || '';
      }
      setInquiryNotes(notesMap);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to load School Website CMS' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [activeSchool?.id]);

  const handleCopy = async (key: string, text: string) => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 2200);
    }
  };

  const handleImageUpload = async (
    file: File | undefined,
    onDone: (dataUrl: string) => void
  ) => {
    if (!file) return;
    try {
      const compressed = await compressImageFileToDataUrl(file);
      onDone(compressed);
      setFeedback({ type: 'ok', text: 'Photo compressed and ready to save.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Could not process image file.' });
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await api.updateSchoolWebsiteAdminProfile({
        ...profileForm,
        portal_subdomain: subdomainInput.trim(),
      });
      setProfileForm(res.website);
      setUrls(res.urls);
      setSubdomainInput(res.urls?.portal_subdomain || subdomainInput);
      await refreshMe().catch(() => {});
      setFeedback({ type: 'ok', text: res.message || 'School website branding and live URL handle updated.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to update school website settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const payload = {
        title: postForm.title.trim(),
        category: postForm.category.trim() || 'News',
        excerpt: postForm.excerpt.trim(),
        content: postForm.content.trim(),
        cover_image_url: postForm.cover_image_url.trim() || null,
        author_name: postForm.author_name.trim(),
        author_role: postForm.author_role.trim(),
        is_published: postForm.is_published,
        is_featured: postForm.is_featured,
      };
      if (editingPost) {
        await api.updateWebsitePost(editingPost.id, {
          ...payload,
          is_published: payload.is_published ? 1 : 0,
          is_featured: payload.is_featured ? 1 : 0,
        } as any);
        setFeedback({ type: 'ok', text: 'Article updated.' });
      } else {
        await api.createWebsitePost(payload);
        setFeedback({ type: 'ok', text: 'Article published to school website.' });
      }
      setPostModalOpen(false);
      setEditingPost(null);
      const res = await api.getWebsitePosts();
      setPosts(res.posts || []);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to save article.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePostPublish = async (post: SchoolWebsitePost) => {
    try {
      await api.updateWebsitePost(post.id, {
        is_published: post.is_published ? 0 : 1,
      });
      const res = await api.getWebsitePosts();
      setPosts(res.posts || []);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Could not update publish status.' });
    }
  };

  const handleDeletePost = async (id: string) => {
    try {
      await api.deleteWebsitePost(id);
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setFeedback({ type: 'ok', text: 'Article removed.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete article.' });
    }
  };

  const handleAddGalleryItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!galleryForm.image_url.trim()) {
      setFeedback({ type: 'err', text: 'Upload a campus image or paste an image URL first.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await api.createWebsiteGalleryItem({
        title: galleryForm.title.trim(),
        album: galleryForm.album.trim() || 'Campus Life',
        caption: galleryForm.caption.trim(),
        image_url: galleryForm.image_url.trim(),
        is_published: true,
      });
      setGalleryForm({ title: '', album: 'Campus Life', caption: '', image_url: '' });
      const res = await api.getWebsiteGallery();
      setGallery(res.gallery || []);
      setFeedback({ type: 'ok', text: 'Photo added to school gallery.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to upload gallery item.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGalleryItem = async (id: string) => {
    try {
      await api.deleteWebsiteGalleryItem(id);
      setGallery((prev) => prev.filter((g) => g.id !== id));
      setFeedback({ type: 'ok', text: 'Gallery photo deleted.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete gallery photo.' });
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await api.createWebsiteEvent({
        title: eventForm.title.trim(),
        event_date: eventForm.event_date,
        end_date: eventForm.end_date || undefined,
        location: eventForm.location.trim(),
        description: eventForm.description.trim(),
        visibility: eventForm.visibility,
      });
      setEventForm({
        title: '',
        event_date: '',
        end_date: '',
        location: '',
        description: '',
        visibility: 'PUBLIC',
      });
      const res = await api.getWebsiteEvents();
      setEvents(res.events || []);
      setFeedback({ type: 'ok', text: 'Calendar event saved.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to save event.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    try {
      await api.deleteWebsiteEvent(id);
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete event.' });
    }
  };

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const matchedCls = classes.find((c) => c.id === slotForm.class_id);
      await api.createTimetableSlot({
        class_id: slotForm.class_id || undefined,
        class_name: matchedCls?.name || slotForm.class_name.trim() || 'General',
        arm_name: slotForm.arm_name.trim() || undefined,
        day_of_week: slotForm.day_of_week,
        period_label: slotForm.period_label.trim(),
        start_time: slotForm.start_time,
        end_time: slotForm.end_time,
        subject_name: slotForm.subject_name.trim(),
        teacher_name: slotForm.teacher_name.trim() || undefined,
        room_label: slotForm.room_label.trim() || undefined,
      });
      setSlotForm((prev) => ({ ...prev, subject_name: '', teacher_name: '', room_label: '' }));
      const res = await api.getAdminTimetable();
      setSlots(res.slots || []);
      setFeedback({ type: 'ok', text: 'Timetable slot added.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to add timetable slot.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSlot = async (id: string) => {
    try {
      await api.deleteTimetableSlot(id);
      setSlots((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete timetable slot.' });
    }
  };

  const handleUpdateInquiry = async (
    id: string,
    status: 'NEW' | 'CONTACTED' | 'ENROLLED' | 'ARCHIVED'
  ) => {
    try {
      const res = await api.updateAdmissionInquiryStatus(id, {
        status,
        admin_notes: inquiryNotes[id] ?? '',
      });
      setInquiries((prev) => prev.map((inq) => (inq.id === id ? res.inquiry : inq)));
      setFeedback({ type: 'ok', text: 'Inquiry status updated.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to update inquiry.' });
    }
  };

  const directPortalUrl = activeSchool?.slug
    ? `${window.location.origin}/#portal/${activeSchool.slug}`
    : `${window.location.origin}/#portal/${urls?.portal_subdomain || ''}`;
  const sitePathUrl = `${window.location.origin}/site/${urls?.portal_subdomain || activeSchool?.slug || ''}`;
  const subdomainUrl = urls?.subdomainUrl || `https://${urls?.portal_subdomain || activeSchool?.slug || 'school'}.bursariq.com.ng`;

  const navItems: Array<{ key: ManagerTab; label: string; icon: any; count?: number }> = [
    { key: 'branding', label: 'Website & Subdomain', icon: Globe },
    { key: 'posts', label: 'News & Blog Articles', icon: Newspaper, count: posts.length },
    { key: 'gallery', label: 'Photo Gallery', icon: ImageIcon, count: gallery.length },
    { key: 'events', label: 'School Calendar', icon: Calendar, count: events.length },
    { key: 'timetable', label: 'Class Timetable', icon: Clock, count: slots.length },
    { key: 'inquiries', label: 'Admissions Inquiries', icon: Inbox, count: inquiries.filter((i) => i.status === 'NEW').length },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Live Shareable Website Links */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Globe className="w-5 h-5 text-emerald-600" />
              <span>Public School Website, Subdomain &amp; Content Studio</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Customize your school&apos;s unique website showcase, publish articles, upload campus photos, manage timetables, and receive admissions inquiries.
            </p>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            Status:{' '}
            <strong className={profileForm.is_published ? 'text-emerald-700' : 'text-amber-700'}>
              {profileForm.is_published ? 'Website Live & Public' : 'Unpublished Draft'}
            </strong>
          </div>
        </div>

        {/* Copyable Live Website & Portal Links Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-900 text-white flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] text-emerald-300 font-semibold">Live Shareable Website Link (Recommended)</p>
              <p className="font-mono text-white font-semibold truncate select-all">{sitePathUrl}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => handleCopy('sitepath', sitePathUrl)}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                {copiedField === 'sitepath' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'sitepath' ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const handle = urls?.portal_subdomain || activeSchool?.slug || '';
                  if (onPreviewLiveWebsite && handle) {
                    onPreviewLiveWebsite(handle);
                  } else if (handle) {
                    window.location.href = `/site/${handle}`;
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                title="Open your live public school website"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                <span>Open</span>
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500">Direct Portal Hash Link (Works Everywhere)</p>
              <p className="font-mono text-slate-800 font-semibold truncate select-all">{directPortalUrl}</p>
            </div>
            <button
              type="button"
              onClick={() => handleCopy('portal', directPortalUrl)}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
            >
              {copiedField === 'portal' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedField === 'portal' ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500">Custom Wildcard Host (Requires *.bursariq.com.ng DNS)</p>
              <p className="font-mono text-slate-600 font-semibold truncate select-all">{subdomainUrl}</p>
            </div>
            <button
              type="button"
              onClick={() => handleCopy('subdomain', subdomainUrl)}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
            >
              {copiedField === 'subdomain' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedField === 'subdomain' ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  active ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums ${
                      active ? 'bg-white/20 text-white' : 'bg-white text-slate-700'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </span>
          <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-400">
          Loading School Website CMS...
        </div>
      ) : (
        <>
          {/* TAB 1: WEBSITE BRANDING & SUBDOMAIN */}
          {tab === 'branding' && (
            <form onSubmit={handleSaveBranding} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Custom Portal Subdomain *</label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      required
                      value={subdomainInput}
                      onChange={(e) => setSubdomainInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      placeholder="e.g. bright-stars-college"
                      className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-l-xl font-mono"
                    />
                    <span className="px-3 py-2.5 bg-slate-100 border border-l-0 border-slate-300 rounded-r-xl text-slate-600 font-mono">
                      .bursariq.com.ng
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Lowercase letters, numbers, and hyphens only. Must be globally unique across BursarIQ.
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Website Theme Palette</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {THEME_ACCENT_OPTIONS.map((opt) => {
                      const active = (profileForm.theme_accent || 'emerald') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setProfileForm({ ...profileForm, theme_accent: opt.value })}
                          className={`px-3 py-2 rounded-xl border text-left font-semibold flex items-center gap-2 cursor-pointer transition ${
                            active ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded-sm shrink-0 ${opt.swatch}`} />
                          <span className="truncate">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">School Motto / Tagline</label>
                  <input
                    type="text"
                    value={profileForm.tagline || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, tagline: e.target.value })}
                    placeholder="e.g. Excellence, Discipline & Integrity"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Year Established</label>
                  <input
                    type="text"
                    value={profileForm.established_year || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, established_year: e.target.value })}
                    placeholder="e.g. 2008"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Hero Banner Headline</label>
                  <input
                    type="text"
                    value={profileForm.hero_title || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, hero_title: e.target.value })}
                    placeholder="e.g. Nurturing Tomorrow's Leaders Today"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Hero Campus Image (Upload or URL)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={profileForm.hero_image_url || ''}
                      onChange={(e) => setProfileForm({ ...profileForm, hero_image_url: e.target.value })}
                      placeholder="https://... or upload image"
                      className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                    <label className="px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) =>
                          handleImageUpload(e.target.files?.[0], (url) =>
                            setProfileForm((prev) => ({ ...prev, hero_image_url: url }))
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Hero Subtitle</label>
                  <textarea
                    rows={2}
                    value={profileForm.hero_subtitle || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, hero_subtitle: e.target.value })}
                    placeholder="Brief welcoming introduction shown prominently at the top of your school website..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">About Section Body</label>
                  <textarea
                    rows={3}
                    value={profileForm.about_body || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, about_body: e.target.value })}
                    placeholder="Describe your school's heritage, WAEC/NECO track record, STEM labs, and values..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Vision Statement</label>
                  <textarea
                    rows={2}
                    value={profileForm.vision || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, vision: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mission Statement</label>
                  <textarea
                    rows={2}
                    value={profileForm.mission || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, mission: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Core Values</label>
                  <input
                    type="text"
                    value={profileForm.core_values || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, core_values: e.target.value })}
                    placeholder="e.g. Integrity, Excellence, Diligence, Respect"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Campus Facilities Summary</label>
                  <input
                    type="text"
                    value={profileForm.facilities_text || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, facilities_text: e.target.value })}
                    placeholder="e.g. ICT Lab, Science Laboratories, Library, Sports Complex"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Principal / Head Name</label>
                  <input
                    type="text"
                    value={profileForm.principal_name || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, principal_name: e.target.value })}
                    placeholder="e.g. Chief Mrs. Folake Adeyemi"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Principal Photo (Upload or URL)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={profileForm.principal_photo_url || ''}
                      onChange={(e) => setProfileForm({ ...profileForm, principal_photo_url: e.target.value })}
                      placeholder="https://... or upload portrait"
                      className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                    <label className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) =>
                          handleImageUpload(e.target.files?.[0], (url) =>
                            setProfileForm((prev) => ({ ...prev, principal_photo_url: url }))
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Principal&apos;s Welcome Address</label>
                  <textarea
                    rows={3}
                    value={profileForm.principal_message || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, principal_message: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-5">
                  <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(profileForm.admissions_open)}
                      onChange={(e) => setProfileForm({ ...profileForm, admissions_open: e.target.checked ? 1 : 0 })}
                    />
                    <span>Admissions Open Banner</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(profileForm.is_published ?? 1)}
                      onChange={(e) => setProfileForm({ ...profileForm, is_published: e.target.checked ? 1 : 0 })}
                    />
                    <span>Public Website Published</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving Website...' : 'Save Website & Subdomain'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: NEWS & BLOG ARTICLES */}
          {tab === 'posts' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Published School Articles &amp; News ({posts.length})</h3>
                  <p className="text-slate-500 mt-0.5">
                    Write term newsletters, inter-house sports highlights, WAEC/BECE distinctions, and PTA updates.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPost(null);
                    setPostForm({
                      title: '',
                      category: 'News',
                      excerpt: '',
                      content: '',
                      cover_image_url: '',
                      author_name: 'School Editorial Desk',
                      author_role: 'Administration',
                      is_published: true,
                      is_featured: false,
                    });
                    setPostModalOpen(true);
                  }}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer self-start"
                >
                  <Plus className="w-4 h-4" />
                  <span>Write New Article</span>
                </button>
              </div>

              {posts.length === 0 ? (
                <p className="py-10 text-center text-slate-400">No articles created yet. Click &ldquo;Write New Article&rdquo; to publish your first story.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {posts.map((post) => (
                    <div key={post.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-3.5 min-w-0">
                        {post.cover_image_url && (
                          <img
                            src={post.cover_image_url}
                            alt={post.title}
                            referrerPolicy="no-referrer"
                            className="w-20 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                          />
                        )}
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span className="font-semibold text-emerald-700">{post.category || 'News'}</span>
                            <span aria-hidden="true">·</span>
                            <span>{post.is_published ? 'Published' : 'Draft'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {post.published_at || post.created_at
                                ? new Date(post.published_at || post.created_at || '').toLocaleDateString()
                                : ''}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-slate-900 truncate">{post.title}</h4>
                          <p className="text-slate-600 line-clamp-2">{post.excerpt || post.content}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTogglePostPublish(post)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer"
                        >
                          {post.is_published ? 'Unpublish' : 'Publish'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPost(post);
                            setPostForm({
                              title: post.title,
                              category: post.category || 'News',
                              excerpt: post.excerpt || '',
                              content: post.content,
                              cover_image_url: post.cover_image_url || '',
                              author_name: post.author_name || '',
                              author_role: post.author_role || '',
                              is_published: Boolean(post.is_published),
                              is_featured: Boolean(post.is_featured),
                            });
                            setPostModalOpen(true);
                          }}
                          className="p-2 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 cursor-pointer"
                          aria-label="Edit article"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePost(post.id)}
                          className="p-2 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
                          aria-label="Delete article"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CAMPUS PHOTO GALLERY */}
          {tab === 'gallery' && (
            <div className="space-y-6 text-xs">
              <form onSubmit={handleAddGalleryItem} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Upload Campus Photo to Gallery</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Photo Title *</label>
                    <input
                      type="text"
                      required
                      value={galleryForm.title}
                      onChange={(e) => setGalleryForm({ ...galleryForm, title: e.target.value })}
                      placeholder="e.g. Science Fair Exhibition"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Album</label>
                    <input
                      type="text"
                      value={galleryForm.album}
                      onChange={(e) => setGalleryForm({ ...galleryForm, album: e.target.value })}
                      placeholder="e.g. Campus Life, Sports, Labs"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Caption</label>
                    <input
                      type="text"
                      value={galleryForm.caption}
                      onChange={(e) => setGalleryForm({ ...galleryForm, caption: e.target.value })}
                      placeholder="Optional caption"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Upload File or Paste URL *</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={galleryForm.image_url}
                        onChange={(e) => setGalleryForm({ ...galleryForm, image_url: e.target.value })}
                        placeholder="https://... or upload"
                        className="flex-1 min-w-0 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                      />
                      <label className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                        <Upload className="w-3.5 h-3.5" />
                        <span>File</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) =>
                            handleImageUpload(e.target.files?.[0], (url) =>
                              setGalleryForm((prev) => ({ ...prev, image_url: url }))
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Photo to Gallery</span>
                  </button>
                </div>
              </form>

              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <h3 className="text-sm font-bold text-slate-900 mb-4">Published Gallery Photos ({gallery.length})</h3>
                {gallery.length === 0 ? (
                  <p className="py-10 text-center text-slate-400">No gallery photos uploaded yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {gallery.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex flex-col justify-between">
                        <img
                          src={item.image_url}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full aspect-4/3 object-cover"
                        />
                        <div className="p-3 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-500">{item.album}</p>
                            <p className="font-bold text-slate-900 truncate">{item.title}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteGalleryItem(item.id)}
                            className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg shrink-0 cursor-pointer"
                            aria-label="Delete photo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: SCHOOL CALENDAR EVENTS */}
          {tab === 'events' && (
            <div className="space-y-6 text-xs">
              <form onSubmit={handleCreateEvent} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Add School Calendar Event</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="lg:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Event Title *</label>
                    <input
                      type="text"
                      required
                      value={eventForm.title}
                      onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                      placeholder="e.g. Inter-House Sports Festival"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Event Date *</label>
                    <input
                      type="date"
                      required
                      value={eventForm.event_date}
                      onChange={(e) => setEventForm({ ...eventForm, event_date: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Location</label>
                    <input
                      type="text"
                      value={eventForm.location}
                      onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                      placeholder="e.g. Main Assembly Hall"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Visibility</label>
                    <select
                      value={eventForm.visibility}
                      onChange={(e) => setEventForm({ ...eventForm, visibility: e.target.value as 'PUBLIC' | 'STAFF_ONLY' })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    >
                      <option value="PUBLIC">Public (Website, Parents &amp; Students)</option>
                      <option value="STAFF_ONLY">Staff Only (Confidential Internal Calendar)</option>
                    </select>
                  </div>
                  <div className="lg:col-span-5">
                    <label className="block font-semibold text-slate-700 mb-1">Event Description</label>
                    <input
                      type="text"
                      value={eventForm.description}
                      onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                      placeholder="Optional agenda or instructions..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Save Calendar Event</span>
                  </button>
                </div>
              </form>

              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <h3 className="text-sm font-bold text-slate-900 mb-4">Scheduled Events ({events.length})</h3>
                {events.length === 0 ? (
                  <p className="py-10 text-center text-slate-400">No calendar events created yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {events.map((ev) => (
                      <div key={ev.id} className="py-3.5 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span className="font-mono font-semibold text-slate-700 tabular-nums">{ev.event_date}</span>
                            <span aria-hidden="true">·</span>
                            <span className={ev.visibility === 'STAFF_ONLY' ? 'font-bold text-rose-700' : 'text-emerald-700 font-semibold'}>
                              {ev.visibility === 'STAFF_ONLY' ? 'Confidential Staff Only' : 'Public School Event'}
                            </span>
                            {ev.location && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{ev.location}</span>
                              </>
                            )}
                          </div>
                          <p className="text-sm font-bold text-slate-900">{ev.title}</p>
                          {ev.description && <p className="text-slate-600">{ev.description}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteEvent(ev.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer"
                          aria-label="Delete event"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: CLASS TIMETABLE BUILDER */}
          {tab === 'timetable' && (
            <div className="space-y-6 text-xs">
              <form onSubmit={handleCreateSlot} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Add Class Timetable Slot</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Class</label>
                    {classes.length > 0 ? (
                      <select
                        value={slotForm.class_id}
                        onChange={(e) => {
                          const cls = classes.find((c) => c.id === e.target.value);
                          setSlotForm({ ...slotForm, class_id: e.target.value, class_name: cls?.name || '' });
                        }}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                      >
                        <option value="">Select or Type Class...</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        required
                        value={slotForm.class_name}
                        onChange={(e) => setSlotForm({ ...slotForm, class_name: e.target.value })}
                        placeholder="e.g. JSS 1"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Day of Week *</label>
                    <select
                      value={slotForm.day_of_week}
                      onChange={(e) => setSlotForm({ ...slotForm, day_of_week: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    >
                      {DAYS_OF_WEEK.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Start Time *</label>
                    <input
                      type="time"
                      required
                      value={slotForm.start_time}
                      onChange={(e) => setSlotForm({ ...slotForm, start_time: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">End Time *</label>
                    <input
                      type="time"
                      required
                      value={slotForm.end_time}
                      onChange={(e) => setSlotForm({ ...slotForm, end_time: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Subject *</label>
                    <input
                      type="text"
                      required
                      value={slotForm.subject_name}
                      onChange={(e) => setSlotForm({ ...slotForm, subject_name: e.target.value })}
                      placeholder="e.g. Mathematics"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Teacher</label>
                    <input
                      type="text"
                      value={slotForm.teacher_name}
                      onChange={(e) => setSlotForm({ ...slotForm, teacher_name: e.target.value })}
                      placeholder="e.g. Mr. Adewale"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Arm / Stream</label>
                    <input
                      type="text"
                      value={slotForm.arm_name}
                      onChange={(e) => setSlotForm({ ...slotForm, arm_name: e.target.value })}
                      placeholder="e.g. Gold (Optional)"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Classroom / Lab</label>
                    <input
                      type="text"
                      value={slotForm.room_label}
                      onChange={(e) => setSlotForm({ ...slotForm, room_label: e.target.value })}
                      placeholder="e.g. Room 4"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Timetable Period</span>
                  </button>
                </div>
              </form>

              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <h3 className="text-sm font-bold text-slate-900 mb-4">Weekly School Timetable ({slots.length} slots)</h3>
                {slots.length === 0 ? (
                  <p className="py-10 text-center text-slate-400">No timetable slots configured yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                          <th className="py-2.5 px-3">Day</th>
                          <th className="py-2.5 px-3">Time</th>
                          <th className="py-2.5 px-3">Class</th>
                          <th className="py-2.5 px-3">Subject</th>
                          <th className="py-2.5 px-3">Teacher</th>
                          <th className="py-2.5 px-3">Room</th>
                          <th className="py-2.5 px-3 text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {slots.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2.5 px-3 font-semibold text-slate-900">{s.day_of_week}</td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                              {s.start_time} – {s.end_time}
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">
                              {s.class_name}
                              {s.arm_name ? ` (${s.arm_name})` : ''}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-emerald-700">{s.subject_name}</td>
                            <td className="py-2.5 px-3 text-slate-600">{s.teacher_name || '—'}</td>
                            <td className="py-2.5 px-3 text-slate-600">{s.room_label || '—'}</td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleDeleteSlot(s.id)}
                                className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer"
                                aria-label="Delete slot"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 6: ADMISSIONS INQUIRIES INBOX */}
          {tab === 'inquiries' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 text-xs">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Prospective Admissions Inquiries ({inquiries.length})</h3>
                <p className="text-slate-500 mt-0.5">
                  Submitted directly from your public school website by prospective parents and guardians.
                </p>
              </div>

              {inquiries.length === 0 ? (
                <p className="py-10 text-center text-slate-400">No admissions inquiries submitted yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {inquiries.map((inq) => (
                    <div key={inq.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span className="font-bold text-slate-900 text-sm">{inq.student_name}</span>
                            {inq.target_class && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>Target: {inq.target_class}</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{inq.id}</span>
                          </div>
                          <p className="text-slate-600 mt-0.5">
                            Parent: <strong>{inq.parent_name}</strong> · Phone: <span className="font-mono">{inq.parent_phone}</span>
                            {inq.parent_email ? ` · ${inq.parent_email}` : ''}
                          </p>
                          {inq.message && <p className="text-slate-700 mt-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200">{inq.message}</p>}
                        </div>

                        <span className="font-bold text-[11px] text-emerald-700 shrink-0">
                          Status: {inq.status}
                        </span>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <input
                          type="text"
                          value={inquiryNotes[inq.id] ?? ''}
                          onChange={(e) => setInquiryNotes((prev) => ({ ...prev, [inq.id]: e.target.value }))}
                          placeholder="Admissions office follow-up note..."
                          className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                        />
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(['NEW', 'CONTACTED', 'ENROLLED', 'ARCHIVED'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => handleUpdateInquiry(inq.id, st)}
                              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition ${
                                inq.status === st
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Article Editor Modal */}
      {postModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">{editingPost ? 'Edit School Article' : 'Publish New School Article'}</h3>
              <button
                type="button"
                onClick={() => setPostModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSavePost} className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Article Title *</label>
                  <input
                    type="text"
                    required
                    value={postForm.title}
                    onChange={(e) => setPostForm({ ...postForm, title: e.target.value })}
                    placeholder="e.g. 2026 Cultural & Career Day Celebration"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={postForm.category}
                    onChange={(e) => setPostForm({ ...postForm, category: e.target.value })}
                    placeholder="News, Academics, Sports"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Author Name</label>
                  <input
                    type="text"
                    value={postForm.author_name}
                    onChange={(e) => setPostForm({ ...postForm, author_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cover Photo (Upload or URL)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={postForm.cover_image_url}
                      onChange={(e) => setPostForm({ ...postForm, cover_image_url: e.target.value })}
                      placeholder="https://... or upload"
                      className="flex-1 min-w-0 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                    <label className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) =>
                          handleImageUpload(e.target.files?.[0], (url) =>
                            setPostForm((prev) => ({ ...prev, cover_image_url: url }))
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Short Summary / Excerpt</label>
                <input
                  type="text"
                  value={postForm.excerpt}
                  onChange={(e) => setPostForm({ ...postForm, excerpt: e.target.value })}
                  placeholder="Brief 1-sentence summary shown on article card..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Article Content *</label>
                <textarea
                  rows={6}
                  required
                  value={postForm.content}
                  onChange={(e) => setPostForm({ ...postForm, content: e.target.value })}
                  placeholder="Write the full school article or newsletter dispatch..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex items-center gap-5">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={postForm.is_published}
                    onChange={(e) => setPostForm({ ...postForm, is_published: e.target.checked })}
                  />
                  <span>Publish immediately on school website</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={postForm.is_featured}
                    onChange={(e) => setPostForm({ ...postForm, is_featured: e.target.checked })}
                  />
                  <span>Feature on top</span>
                </label>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPostModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Article'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
