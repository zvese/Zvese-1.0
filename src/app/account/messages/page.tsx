import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, CheckIcon, MailIcon, MailOpenIcon } from "lucide-react";

import { markNotificationRead } from "@/app/account/messages/actions";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Messages",
  description: "View your Zvese account notifications.",
};

interface AccountNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  related_seller_profile_id: string | null;
  read_at: string | null;
  created_at: string;
}

function formatNotificationDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AccountMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?message=Please sign in to view your messages.");
  }

  const { data, error: notificationsError } = await supabase
    .from("notifications")
    .select(
      "id, type, title, body, related_seller_profile_id, read_at, created_at"
    )
    .order("created_at", { ascending: false });

  if (notificationsError) {
    throw new Error("Could not load your Zvese messages.");
  }

  const notifications = (data ?? []) as AccountNotification[];
  const { error: pageError } = await searchParams;

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Button asChild variant="ghost" size="sm">
        <Link href="/account">
          <ArrowLeftIcon className="size-4" />
          Account
        </Link>
      </Button>

      <div className="mt-6">
        <p className="text-sm font-medium text-primary">Your Zvese account</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Messages</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Account and seller-application notifications from Zvese.
        </p>
      </div>

      {pageError ? (
        <p className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {pageError}
        </p>
      ) : null}

      <div className="mt-8 space-y-4">
        {notifications.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-xs">
            <MailIcon className="mx-auto size-9 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">No messages yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              New Zvese account notifications will appear here.
            </p>
          </div>
        ) : (
          notifications.map((notification) => {
            const isUnread = notification.read_at === null;

            return (
              <article
                key={notification.id}
                className={`rounded-2xl border p-5 shadow-xs sm:p-6 ${
                  isUnread
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-primary">
                    {isUnread ? (
                      <MailIcon className="size-4" />
                    ) : (
                      <MailOpenIcon className="size-4" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="font-semibold">{notification.title}</h2>
                          {isUnread ? (
                            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                              Unread
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatNotificationDate(notification.created_at)}
                        </p>
                      </div>
                    </div>

                    <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                      {notification.body}
                    </p>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      {notification.related_seller_profile_id ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href="/account">View seller status</Link>
                        </Button>
                      ) : null}

                      {isUnread ? (
                        <form action={markNotificationRead}>
                          <input
                            type="hidden"
                            name="notification_id"
                            value={notification.id}
                          />
                          <Button type="submit" size="sm" variant="ghost">
                            <CheckIcon className="size-4" />
                            Mark as read
                          </Button>
                        </form>
                      ) : (
                        <span className="text-xs text-muted-foreground">Read</span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
