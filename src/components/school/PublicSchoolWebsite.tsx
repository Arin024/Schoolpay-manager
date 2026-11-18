import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  GraduationCap,
  Image as ImageIcon,
  Mail,
  MapPin,
  Newspaper,
  Phone,
  Send,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../services/api.js';
import {
  PublicSchoolWebsiteData,
  SchoolWebsiteGalleryItem,
  SchoolWebsitePost,
  WebsiteThemeAccent,
} from '../../types/index.js';
import { LoginForm } from '../auth/LoginForm.js';

interface PublicSchoolWebsiteProps {
  portalSlug: string;
  onClearPortal: () => void;
  onAuthSuccess: () => void;
  onNavigateRegister: () => void;
  onSelectSchoolPortal: (slug: string) => void;
  onForgotPassword?: () => void;
}

interface AccentThemePalette {
  heroBg: string;
  heroBorder: string;
  buttonBg: string;
  buttonHover: string;
  accentText: string;
  softSurface: string;
  softBorder: string;
  crestBg: string;
}

const ACCENT_PALETTES: Record<WebsiteThemeAccent, AccentThemePalette> = {
  emerald: {
    heroBg: 'from-slate-950 via-slate-900 to-emerald-950',
    heroBorder: 'border-emerald-800/60',
    buttonBg: 'bg-emerald-600',
    buttonHover: 'hover:bg-emerald-500',
    accentText: 'text-emerald-700',
    softSurface: 'bg-emerald-50/70',
    softBorder: 'border-emerald-200',
    crestBg: 'bg-emerald-600',
  },
  navy: {
    heroBg: 'from-slate-950 via-blue-950 to-slate-900',
    heroBorder: 'border-blue-800/60',
    buttonBg: 'bg-blue-700',
    buttonHover: 'hover:bg-blue-600',
    accentText: 'text-blue-700',
    softSurface: 'bg-blue-50/70',
    softBorder: 'border-blue-200',
    crestBg: 'bg-blue-700',
  },
  indigo: {
    heroBg: 'from-slate-950 via-indigo-950 to-slate-900',
    heroBorder: 'border-indigo-800/60',
    buttonBg: 'bg-indigo-600',
    buttonHover: 'hover:bg-indigo-500',
    accentText: 'text-indigo-700',
    softSurface: 'bg-indigo-50/70',
    softBorder: 'border-indigo-200',
    crestBg: 'bg-indigo-600',
  },
  burgundy: {
    heroBg: 'from-stone-950 via-rose-950 to-slate-950',
    heroBorder: 'border-rose-900/60',
    buttonBg: 'bg-rose-700',
    buttonHover: 'hover:bg-rose-600',
    accentText: 'text-rose-700',
    softSurface: 'bg-rose-50/70',
    softBorder: 'border-rose-200',
    crestBg: 'bg-rose-700',
  },
  teal: {
    heroBg: 'from-slate-950 via-teal-950 to-slate-900',
    heroBorder: 'border-teal-800/60',
    buttonBg: 'bg-teal-600',
    buttonHover: 'hover:bg-teal-500',
    accentText: 'text-teal-700',
    softSurface: 'bg-teal-50/70',
    softBorder: 'border-teal-200',
    crestBg: 'bg-teal-600',
  },
};

export const PublicSchoolWebsite: React.FC<PublicSchoolWebsiteProps> = ({
  portalSlug,
  onClearPortal,
  onAuthSuccess,
  onNavigateRegister,
  onSelectSchoolPortal,
  onForgotPassword,
}) => {
  const [data, setData] = useState<PublicSchoolWebsiteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Interactive Filters & Modals
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedAlbum, setSelectedAlbum] = useState<string>('ALL');
  const [activeArticle, setActiveArticle] = useState<SchoolWebsitePost | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Copy feedback
  const [copiedUrl, setCopiedUrl] = useState<'subdomain' | 'portal' | null>(null);

  // Prospective Admissions Inquiry Form
  const [inquiryForm, setInquiryForm] = useState({
    student_name: '',
    target_class: '',
    parent_name: '',
    parent_phone: '',
    parent_email: '',
    message: '',
  });
  const [inquirySubmitting, setInquirySubmitting] = useState(false);
  const [inquiryResult, setInquiryResult] = useState<{ type: 'ok' | 'err'; text: string; refId?: string } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSelectedCategory('ALL');
    setSelectedAlbum('ALL');
    setInquiryResult(null);

    api
      .getPublicSchoolWebsite(portalSlug)
      .then((res) => {
        if (!active) return;
        setData(res);
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err?.message || 'Unable to load this school portal website.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [portalSlug]);

  const theme = ACCENT_PALETTES[data?.website?.theme_accent || 'emerald'] || ACCENT_PALETTES.emerald;

  const categories = useMemo(() => {
    const unique = Array.from(new Set((data?.posts || []).map((p) => p.category || 'News').filter(Boolean)));
    return ['ALL', ...unique];
  }, [data?.posts]);

  const filteredPosts = useMemo(() => {
    const list = data?.posts || [];
    if (selectedCategory === 'ALL') return list;
    return list.filter((p) => (p.category || 'News') === selectedCategory);
  }, [data?.posts, selectedCategory]);

  const albums = useMemo(() => {
    const unique = Array.from(new Set((data?.gallery || []).map((g) => g.album || 'Campus Life').filter(Boolean)));
    return ['ALL', ...unique];
  }, [data?.gallery]);

  const filteredGallery = useMemo(() => {
    const list = data?.gallery || [];
    if (selectedAlbum === 'ALL') return list;
    return list.filter((g) => (g.album || 'Campus Life') === selectedAlbum);
  }, [data?.gallery, selectedAlbum]);

  const handleCopy = (kind: 'subdomain' | 'portal', value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedUrl(kind);
    setTimeout(() => setCopiedUrl(null), 2200);
  };

  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInquirySubmitting(true);
    setInquiryResult(null);
    try {
      const res = await api.submitAdmissionInquiry(portalSlug, {
        student_name: inquiryForm.student_name.trim(),
        target_class: inquiryForm.target_class.trim() || undefined,
        parent_name: inquiryForm.parent_name.trim(),
        parent_phone: inquiryForm.parent_phone.trim(),
        parent_email: inquiryForm.parent_email.trim() || undefined,
        message: inquiryForm.message.trim() || undefined,
      });
      setInquiryResult({
        type: 'ok',
        text: res.message || 'Your admissions inquiry has been sent to the school office.',
        refId: res.inquiry?.id,
      });
      setInquiryForm({
        student_name: '',
        target_class: '',
        parent_name: '',
        parent_phone: '',
        parent_email: '',
        message: '',
      });
    } catch (err: any) {
      setInquiryResult({
        type: 'err',
        text: err?.message || 'Could not submit inquiry right now. Please check all fields.',
      });
    } finally {
      setInquirySubmitting(false);
    }
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-8 py-8">
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-100 mx-auto animate-pulse" />
          <p className="text-sm font-semibold text-slate-600">Loading Official School Website...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-8 py-6">
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center space-y-4">
          <h2 className="text-xl font-bold text-slate-900">School Portal Not Found</h2>
          <p className="text-sm text-slate-600 max-w-lg mx-auto">{error}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onClearPortal}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer"
            >
              Return to BursarIQ Directory
            </button>
          </div>
        </div>

        <LoginForm
          onSwitchToRegister={onNavigateRegister}
          onForgotPassword={onForgotPassword || (() => {})}
          onSuccess={onAuthSuccess}
          initialPortalSlug={portalSlug}
          onPortalSlugChange={(nextSlug) => {
            if (nextSlug) onSelectSchoolPortal(nextSlug);
            else onClearPortal();
          }}
        />
      </div>
    );
  }

  if (!data) return null;

  const { school, website, urls, settings, posts, gallery, events, classes, stats } = data;
  const shareablePortalUrl = `${window.location.origin}/#portal/${school.slug}`;
  const shareableSubdomainUrl = urls?.subdomainUrl || `https://${urls?.portal_subdomain || school.slug}.bursariq.com.ng`;
  const activeLightboxItem: SchoolWebsiteGalleryItem | null =
    lightboxIndex !== null && filteredGallery[lightboxIndex] ? filteredGallery[lightboxIndex] : null;

  return (
    <div className="space-y-8 sm:space-y-12 pb-10 min-w-0">
      {/* Three-Zone Responsive School Website Bar */}
      <nav
        aria-label="School website navigation"
        className="bg-white rounded-2xl border border-slate-200 px-3 sm:px-5 py-3 flex items-center justify-between gap-2 sm:gap-6 min-w-0"
      >
        <a
          href={`#portal/${school.slug}`}
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="text-sm sm:text-lg font-extrabold text-slate-900 tracking-tight truncate min-w-0 flex-1"
        >
          {school.name}
        </a>

        <div className="hidden lg:flex items-center gap-6 text-xs font-semibold text-slate-600 shrink-0">
          <button
            type="button"
            onClick={() => scrollToSection('school-about')}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            About
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('school-news')}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            News &amp; Articles
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('school-gallery')}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Gallery
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('school-calendar')}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Calendar
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('school-admissions')}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Admissions
          </button>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => scrollToSection('school-admissions')}
            className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Apply / Inquiry
          </button>
          <button
            type="button"
            onClick={onClearPortal}
            className={`px-2.5 sm:px-4 py-1.5 sm:py-2 text-[11px] sm:text-xs font-bold text-white ${theme.buttonBg} ${theme.buttonHover} rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
          >
            All Schools
          </button>
        </div>
      </nav>

      {/* Hero Split Banner: School Website Showcase (Left) + Embedded Official School Portal Login (Right) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch min-w-0">
        <div
          className={`lg:col-span-7 min-w-0 bg-gradient-to-br ${theme.heroBg} text-white rounded-3xl border ${theme.heroBorder} overflow-hidden flex flex-col justify-between shadow-sm`}
        >
          {website.hero_image_url ? (
            <div className="relative h-56 sm:h-64 w-full overflow-hidden">
              <img
                src={website.hero_image_url}
                alt={`${school.name} campus`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/35 to-transparent" />
              <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {school.logo_url ? (
                    <img
                      src={school.logo_url}
                      alt={`${school.name} crest`}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-xl object-cover border border-white/25 bg-white shrink-0"
                    />
                  ) : (
                    <div
                      className={`w-12 h-12 rounded-xl ${theme.crestBg} text-white font-black text-xl flex items-center justify-center border border-white/20 shrink-0`}
                    >
                      {school.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">
                      {school.lga}, {school.state} · {school.type}
                    </p>
                    <p className="text-sm font-bold text-white truncate">
                      {website.tagline || 'Excellence in Character and Learning'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-6 sm:px-8 pt-7 pb-3 flex items-center gap-4 border-b border-white/10">
              {school.logo_url ? (
                <img
                  src={school.logo_url}
                  alt={`${school.name} crest`}
                  referrerPolicy="no-referrer"
                  className="w-14 h-14 rounded-2xl object-cover border border-white/25 bg-white shrink-0"
                />
              ) : (
                <div
                  className={`w-14 h-14 rounded-2xl ${theme.crestBg} text-white font-black text-2xl flex items-center justify-center border border-white/20 shrink-0`}
                >
                  {school.name.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs text-slate-300 font-medium">
                  {school.lga}, {school.state} · {school.type}
                  {website.established_year ? ` · Est. ${website.established_year}` : ''}
                </p>
                <p className="text-sm font-bold text-white truncate">
                  {website.tagline || 'Excellence in Character and Learning'}
                </p>
              </div>
            </div>
          )}

          <div className="p-4 sm:p-8 space-y-5 sm:space-y-6 flex-1 flex flex-col justify-between min-w-0">
            <div className="space-y-3 min-w-0">
              <p className="text-xs font-medium text-emerald-300 break-words">
                Official School Website · Session {settings?.current_academic_session || '2025/2026'} ({settings?.current_term || '1st Term'})
              </p>
              <h1
                className="text-2xl sm:text-4xl font-black tracking-tight text-white leading-tight break-words"
                style={{ textWrap: 'balance' }}
              >
                {website.hero_title || `Welcome to ${school.name}`}
              </h1>
              <p className="text-sm text-slate-200 leading-relaxed max-w-2xl break-words">
                {website.hero_subtitle ||
                  website.about_body ||
                  `Official digital campus, academic portal, news updates, and admissions gateway for ${school.name}.`}
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => scrollToSection('school-admissions')}
                  className={`px-4 py-2 text-xs font-bold text-white ${theme.buttonBg} ${theme.buttonHover} rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-sm`}
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>Prospective Student Admissions Form</span>
                </button>
              </div>
            </div>

            {/* Shareable School Subdomain & Link Box */}
            <div className="rounded-2xl bg-white/10 border border-white/15 p-3.5 sm:p-4 space-y-3 text-xs min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                    <span>Official Shareable School Subdomain</span>
                  </p>
                  <p className="font-mono text-white font-semibold break-all sm:truncate select-all mt-0.5 text-[11px] sm:text-xs">
                    {shareableSubdomainUrl}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopy('subdomain', shareableSubdomainUrl)}
                    className="px-3 py-1.5 rounded-lg bg-white text-slate-900 hover:bg-slate-100 font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {copiedUrl === 'subdomain' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedUrl === 'subdomain' ? 'Copied' : 'Copy Subdomain'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy('portal', shareablePortalUrl)}
                    className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {copiedUrl === 'portal' ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <ExternalLink className="w-3.5 h-3.5" />}
                    <span>{copiedUrl === 'portal' ? 'Link Copied' : 'Copy Direct Link'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* School Facts & Contact Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-white/15 text-xs">
              <div>
                <p className="text-slate-300">Enrolled Learners</p>
                <p className="text-lg font-bold text-white tabular-nums mt-0.5">{stats?.studentsCount ?? 0}</p>
              </div>
              <div>
                <p className="text-slate-300">Academic Classes</p>
                <p className="text-lg font-bold text-white tabular-nums mt-0.5">{stats?.classesCount ?? 0}</p>
              </div>
              <div>
                <p className="text-slate-300">Teaching Staff</p>
                <p className="text-lg font-bold text-white tabular-nums mt-0.5">{stats?.staffCount ?? 0}</p>
              </div>
              <div>
                <p className="text-slate-300">Admissions</p>
                <p className="text-sm font-bold text-emerald-300 mt-1">
                  {website.admissions_open ? 'Currently Open' : 'By Inquiry'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Official School Portal Login Card */}
        <div className="lg:col-span-5 min-w-0 flex flex-col justify-start">
          <LoginForm
            onSwitchToRegister={onNavigateRegister}
            onForgotPassword={onForgotPassword || (() => {})}
            onSuccess={onAuthSuccess}
            initialPortalSlug={portalSlug}
            onPortalSlugChange={(nextSlug) => {
              if (nextSlug) onSelectSchoolPortal(nextSlug);
              else onClearPortal();
            }}
          />
        </div>
      </section>

      {/* About, Vision, Mission & Principal's Welcome */}
      <section id="school-about" className="scroll-mt-24 grid grid-cols-1 lg:grid-cols-12 gap-6 min-w-0">
        <div className="lg:col-span-7 min-w-0 bg-white rounded-2xl border border-slate-200 p-5 sm:p-8 space-y-6">
          <div className="space-y-2">
            <p className={`text-xs font-bold ${theme.accentText}`}>About Our School</p>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {website.about_title || `About ${school.name}`}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
              {website.about_body ||
                `${school.name} is committed to academic rigour, moral uprightness, and nurturing confident Nigerian scholars equipped for higher education and global citizenship.`}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-5 border-t border-slate-100 text-xs">
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-slate-900">Our Vision</h3>
              <p className="text-slate-600 leading-relaxed">
                {website.vision || 'Raising disciplined, innovative learners prepared for tertiary excellence and leadership.'}
              </p>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-slate-900">Our Mission</h3>
              <p className="text-slate-600 leading-relaxed">
                {website.mission || 'Delivering NERDC-aligned instruction, continuous assessment, and holistic character mentorship.'}
              </p>
            </div>
          </div>

          {(website.core_values || website.facilities_text) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-5 border-t border-slate-100 text-xs">
              {website.core_values && (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-bold text-slate-900">Core Values</h3>
                  <p className="text-slate-600 leading-relaxed">{website.core_values}</p>
                </div>
              )}
              {website.facilities_text && (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-bold text-slate-900">Campus Facilities</h3>
                  <p className="text-slate-600 leading-relaxed">{website.facilities_text}</p>
                </div>
              )}
            </div>
          )}

          <div className="pt-5 border-t border-slate-100 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 min-w-0">
            {school.address && (
              <span className="inline-flex items-center gap-1.5 min-w-0 break-words">
                <MapPin className={`w-4 h-4 ${theme.accentText} shrink-0`} />
                <span>{school.address}</span>
              </span>
            )}
            {school.phone && (
              <a href={`tel:${school.phone}`} className="inline-flex items-center gap-1.5 hover:text-slate-900 break-all">
                <Phone className={`w-4 h-4 ${theme.accentText} shrink-0`} />
                <span>{school.phone}</span>
              </a>
            )}
            {school.email && (
              <a href={`mailto:${school.email}`} className="inline-flex items-center gap-1.5 hover:text-slate-900 break-all">
                <Mail className={`w-4 h-4 ${theme.accentText} shrink-0`} />
                <span>{school.email}</span>
              </a>
            )}
          </div>
        </div>

        {/* Principal's Welcome Card */}
        <div className="lg:col-span-5 min-w-0 bg-white rounded-2xl border border-slate-200 p-5 sm:p-8 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {website.principal_photo_url ? (
                <img
                  src={website.principal_photo_url}
                  alt={website.principal_name || 'School Principal'}
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className={`w-16 h-16 rounded-2xl ${theme.softSurface} border ${theme.softBorder} ${theme.accentText} flex items-center justify-center font-bold text-xl shrink-0`}>
                  {(website.principal_name || school.name).charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <p className={`text-xs font-semibold ${theme.accentText}`}>
                  {website.principal_title || 'Principal / Head of School'}
                </p>
                <h3 className="text-base font-bold text-slate-900 break-words">
                  {website.principal_name || 'Office of the Principal'}
                </h3>
              </div>
            </div>

            <blockquote className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
              {website.principal_message ||
                `On behalf of our dedicated teaching staff and board of governors, I warmly welcome parents, learners, and visitors to ${school.name}. Use this portal to follow school updates, explore campus life, check verified documents, and log into your dedicated academic workspace.`}
            </blockquote>
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
              <ShieldCheck className={`w-4 h-4 ${theme.accentText}`} />
              <span>Verified BursarIQ School Website</span>
            </span>
            <button
              type="button"
              onClick={() => scrollToSection('school-admissions')}
              className={`font-bold ${theme.accentText} hover:underline cursor-pointer`}
            >
              Submit Admissions Inquiry
            </button>
          </div>
        </div>
      </section>

      {/* News & School Articles */}
      <section id="school-news" className="scroll-mt-24 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className={`text-xs font-bold ${theme.accentText}`}>Newsroom &amp; Publications</p>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">School Articles &amp; Updates</h2>
          </div>

          {categories.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl self-start max-w-full">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                    selectedCategory === cat ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat === 'ALL' ? 'All Stories' : cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {filteredPosts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
            <Newspaper className="w-7 h-7 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">No published articles yet</p>
            <p className="text-xs text-slate-500">
              School administrators can publish school news, term newsletters, and academic achievements from the dashboard.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {filteredPosts.map((post) => (
              <article
                key={post.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col justify-between hover:border-slate-300 transition"
              >
                <div>
                  {post.cover_image_url ? (
                    <img
                      src={post.cover_image_url}
                      alt={post.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-44 object-cover bg-slate-100"
                    />
                  ) : (
                    <div className={`w-full h-36 ${theme.softSurface} border-b ${theme.softBorder} flex items-center justify-center px-6 text-center`}>
                      <div className="space-y-1">
                        <BookOpen className={`w-6 h-6 ${theme.accentText} mx-auto`} />
                        <p className="text-xs font-semibold text-slate-700 line-clamp-1">{post.category || 'School Dispatch'}</p>
                      </div>
                    </div>
                  )}

                  <div className="p-5 space-y-2.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className={`font-semibold ${theme.accentText}`}>{post.category || 'News'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {post.published_at || post.created_at
                          ? new Date(post.published_at || post.created_at || '').toLocaleDateString()
                          : 'Recent'}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 leading-snug">{post.title}</h3>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                      {post.excerpt || post.content}
                    </p>
                  </div>
                </div>

                <div className="px-5 pb-5 pt-2 flex items-center justify-between text-xs border-t border-slate-100">
                  <span className="text-slate-500 truncate max-w-[160px]">
                    {post.author_name || school.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveArticle(post)}
                    className={`font-bold ${theme.accentText} hover:underline cursor-pointer whitespace-nowrap shrink-0`}
                  >
                    Read Full Article
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Campus Photo Gallery */}
      <section id="school-gallery" className="scroll-mt-24 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className={`text-xs font-bold ${theme.accentText}`}>Campus Showcase</p>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">School Photo Gallery</h2>
          </div>

          {albums.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl self-start">
              {albums.map((alb) => (
                <button
                  key={alb}
                  type="button"
                  onClick={() => setSelectedAlbum(alb)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                    selectedAlbum === alb ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {alb === 'ALL' ? 'All Photos' : alb}
                </button>
              ))}
            </div>
          )}
        </div>

        {filteredGallery.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
            <ImageIcon className="w-7 h-7 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">No campus photos uploaded yet</p>
            <p className="text-xs text-slate-500">
              Photos uploaded from the School Website CMS will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredGallery.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLightboxIndex(idx)}
                className="group bg-white rounded-2xl border border-slate-200 overflow-hidden text-left hover:border-slate-300 transition cursor-pointer"
              >
                <div className="relative aspect-4/3 bg-slate-100 overflow-hidden">
                  <img
                    src={item.image_url}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3.5 text-white">
                    <p className="text-[11px] text-slate-200">{item.album || 'Campus Life'}</p>
                    <p className="text-xs font-bold truncate">{item.title}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Upcoming School Calendar & Prospective Admissions Inquiry */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-w-0">
        {/* Public Calendar Events */}
        <div id="school-calendar" className="scroll-mt-24 lg:col-span-5 min-w-0 bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 space-y-5">
          <div>
            <p className={`text-xs font-bold ${theme.accentText}`}>Upcoming Dates</p>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">School Events Calendar</h2>
          </div>

          {events.length === 0 ? (
            <div className="py-10 text-center space-y-2 text-xs text-slate-500">
              <Calendar className="w-6 h-6 text-slate-300 mx-auto" />
              <p>No upcoming public events scheduled yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {events.map((ev) => (
                <div key={ev.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-slate-500 font-mono tabular-nums">
                    <span>{ev.event_date}</span>
                    {ev.location && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans text-slate-600">{ev.location}</span>
                      </>
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">{ev.title}</h3>
                  {ev.description && <p className="text-slate-600 leading-relaxed">{ev.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prospective Admissions Inquiry Form */}
        <div id="school-admissions" className="scroll-mt-24 lg:col-span-7 min-w-0 bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 space-y-5">
          <div className="space-y-1">
            <p className={`text-xs font-bold ${theme.accentText}`}>Admissions &amp; Parent Inquiries</p>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Prospective Student Application &amp; Inquiry Form</h2>
            <p className="text-xs text-slate-600">
              {website.admissions_summary ||
                `Prospective parents interested in enrolling a child into ${school.name} can fill this form. Submissions appear directly on the School Admin & Staff notices desk.`}
            </p>
          </div>

          {inquiryResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2 ${
                inquiryResult.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{inquiryResult.text}</p>
                {inquiryResult.refId && (
                  <p className="font-mono text-[11px] mt-0.5">Reference: {inquiryResult.refId}</p>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleInquirySubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Prospective Student Name *</label>
              <input
                type="text"
                required
                value={inquiryForm.student_name}
                onChange={(e) => setInquiryForm({ ...inquiryForm, student_name: e.target.value })}
                placeholder="e.g. Chinedu Okafor"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Target Class / Level</label>
              {classes.length > 0 ? (
                <select
                  value={inquiryForm.target_class}
                  onChange={(e) => setInquiryForm({ ...inquiryForm, target_class: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="">Select Class...</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={inquiryForm.target_class}
                  onChange={(e) => setInquiryForm({ ...inquiryForm, target_class: e.target.value })}
                  placeholder="e.g. JSS 1 or Primary 4"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                />
              )}
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Parent / Guardian Name *</label>
              <input
                type="text"
                required
                value={inquiryForm.parent_name}
                onChange={(e) => setInquiryForm({ ...inquiryForm, parent_name: e.target.value })}
                placeholder="e.g. Mrs. Ngozi Okafor"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Parent Phone / WhatsApp *</label>
              <input
                type="tel"
                required
                value={inquiryForm.parent_phone}
                onChange={(e) => setInquiryForm({ ...inquiryForm, parent_phone: e.target.value })}
                placeholder="e.g. 08031234567"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Parent Email (Optional)</label>
              <input
                type="email"
                value={inquiryForm.parent_email}
                onChange={(e) => setInquiryForm({ ...inquiryForm, parent_email: e.target.value })}
                placeholder="parent@example.com"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Questions or Notes</label>
              <textarea
                rows={3}
                value={inquiryForm.message}
                onChange={(e) => setInquiryForm({ ...inquiryForm, message: e.target.value })}
                placeholder="Tell us about boarding preference, transfer class, or schedule a campus tour..."
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>

            <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span>Sent directly to {school.name} Admissions Desk</span>
              </span>
              <button
                type="submit"
                disabled={inquirySubmitting}
                className={`px-5 py-2.5 ${theme.buttonBg} ${theme.buttonHover} text-white rounded-xl font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>{inquirySubmitting ? 'Submitting...' : 'Send Admissions Inquiry'}</span>
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Article Reader Modal */}
      {activeArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4">
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <span className={`font-bold ${theme.accentText}`}>{activeArticle.category || 'News'}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {activeArticle.published_at || activeArticle.created_at
                    ? new Date(activeArticle.published_at || activeArticle.created_at || '').toLocaleDateString()
                    : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveArticle(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                aria-label="Close article"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeArticle.cover_image_url && (
              <img
                src={activeArticle.cover_image_url}
                alt={activeArticle.title}
                referrerPolicy="no-referrer"
                className="w-full max-h-72 object-cover bg-slate-100"
              />
            )}

            <div className="p-6 sm:p-8 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-snug">{activeArticle.title}</h2>
              {activeArticle.author_name && (
                <p className="text-xs text-slate-500">
                  By <strong className="text-slate-700">{activeArticle.author_name}</strong>
                  {activeArticle.author_role ? ` · ${activeArticle.author_role}` : ''}
                </p>
              )}
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line pt-2 border-t border-slate-100">
                {activeArticle.content}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox Modal */}
      {activeLightboxItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
          <div className="max-w-3xl w-full bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between text-white">
              <div className="min-w-0">
                <p className="text-[11px] text-slate-400">{activeLightboxItem.album || 'Campus Life'}</p>
                <p className="text-sm font-bold truncate">{activeLightboxItem.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                aria-label="Close photo"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative bg-black flex items-center justify-center max-h-[65vh]">
              <img
                src={activeLightboxItem.image_url}
                alt={activeLightboxItem.title}
                referrerPolicy="no-referrer"
                className="max-h-[65vh] w-auto object-contain"
              />
              {filteredGallery.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxIndex((prev) =>
                        prev === null ? 0 : (prev - 1 + filteredGallery.length) % filteredGallery.length
                      )
                    }
                    className="absolute left-3 p-2 rounded-full bg-black/60 hover:bg-black text-white cursor-pointer"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxIndex((prev) => (prev === null ? 0 : (prev + 1) % filteredGallery.length))
                    }
                    className="absolute right-3 p-2 rounded-full bg-black/60 hover:bg-black text-white cursor-pointer"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            {activeLightboxItem.caption && (
              <div className="px-5 py-3 text-xs text-slate-300 border-t border-slate-800">
                {activeLightboxItem.caption}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
