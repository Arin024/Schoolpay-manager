import React from 'react';
import { SchoolStatus, RoleName } from '../../types/index.js';

interface StatusBadgeProps {
  status: SchoolStatus | string;
  size?: 'sm' | 'md';
}

export const SchoolStatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm font-semibold';

  switch (status) {
    case 'ACTIVE':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 ${sizeClasses}`}>
          ACTIVE
        </span>
      );
    case 'TRIAL':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200 ${sizeClasses}`}>
          TRIAL
        </span>
      );
    case 'GRACE_PERIOD':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200 ${sizeClasses}`}>
          GRACE PERIOD
        </span>
      );
    case 'SUSPENDED':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-rose-50 text-rose-700 border border-rose-200 ${sizeClasses}`}>
          SUSPENDED
        </span>
      );
    case 'EXPIRED':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-slate-100 text-slate-700 border border-slate-300 ${sizeClasses}`}>
          EXPIRED
        </span>
      );
    case 'CANCELLED':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-red-100 text-red-800 border border-red-200 ${sizeClasses}`}>
          CANCELLED
        </span>
      );
    default:
      return (
        <span className={`inline-flex items-center font-medium rounded-full bg-slate-100 text-slate-600 ${sizeClasses}`}>
          {status}
        </span>
      );
  }
};

export const RoleBadge: React.FC<{ role: RoleName | string }> = ({ role }) => {
  switch (role) {
    case 'SUPER_ADMIN':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200 whitespace-nowrap">
          Super Admin
        </span>
      );
    case 'SCHOOL_OWNER':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">
          Proprietor / Owner
        </span>
      );
    case 'SCHOOL_ADMIN':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-200 whitespace-nowrap">
          Principal / Admin
        </span>
      );
    case 'BURSAR':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
          Bursar / Finance
        </span>
      );
    case 'TEACHER':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 whitespace-nowrap">
          Teacher
        </span>
      );
    case 'STAFF':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200 whitespace-nowrap">
          Staff
        </span>
      );
    case 'PARENT':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200 whitespace-nowrap">
          Parent / Guardian
        </span>
      );
    case 'STUDENT':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-cyan-50 text-cyan-800 border border-cyan-200 whitespace-nowrap">
          Student
        </span>
      );
    case 'PARTNER':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-orange-50 text-orange-800 border border-orange-200 whitespace-nowrap">
          Bank / Partner
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 whitespace-nowrap">
          {role}
        </span>
      );
  }
};

export const WorkflowStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'PUBLISHED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
          Published
        </span>
      );
    case 'APPROVED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 whitespace-nowrap">
          Approved
        </span>
      );
    case 'REVIEW':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
          In Review
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
          Draft
        </span>
      );
  }
};

export const AttendanceBadge: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'PRESENT':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
          Present
        </span>
      );
    case 'LATE':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
          Late
        </span>
      );
    case 'EXCUSED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 whitespace-nowrap">
          Excused
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
          Absent
        </span>
      );
  }
};

export const SeverityBadge: React.FC<{ severity: string }> = ({ severity }) => {
  switch (severity) {
    case 'HIGH':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
          High
        </span>
      );
    case 'MEDIUM':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
          Medium
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
          Low
        </span>
      );
  }
};

