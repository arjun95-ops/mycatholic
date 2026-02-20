// Profile Page

'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Calendar,
  CalendarPlus,
  Church,
  Hourglass,
  Loader2,
  MapPin,
  MessageSquare,
  Repeat2,
  Settings,
  Share2,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { useProfile } from '@/lib/features/profile/use-profile';
import { useCreateChat } from '@/lib/features/chat/use-chat';
import { useProfilePosts, useRepliedPosts, useSharedPosts } from '@/lib/features/feed/use-posts';
import { PostCard } from '@/components/feed/post-card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  canReceiveMassInvite,
  canReceiveProfileChat,
  getProfileAge,
  getProfileLocation,
  getProfileRoleLabel,
  getProfileVerificationState,
  getTrustBadge,
  isProfileVerified,
  shouldShowProfileAge,
} from '@/lib/features/profile/profile-status';
import { cn } from '@/lib/utils';

export default function ProfilePage({ params }: { params?: { id?: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = params?.id ? decodeURIComponent(params.id) : undefined;

  const { profile, stats, isLoading, isOwnProfile, follow, unfollow, isFollowing } = useProfile(userId);
  const { mutateAsync: createChat, isPending: isCreatingChat } = useCreateChat();

  const postsQuery = useProfilePosts({ userId });
  const sharedQuery = useSharedPosts({ userId });
  const repliedQuery = useRepliedPosts({ userId });

  const userPosts = useMemo(
    () => postsQuery.data?.pages.flatMap((page) => page.posts) ?? [],
    [postsQuery.data]
  );
  const sharedPosts = useMemo(
    () => sharedQuery.data?.pages.flatMap((page) => page.posts) ?? [],
    [sharedQuery.data]
  );
  const repliedPosts = useMemo(
    () => repliedQuery.data?.pages.flatMap((page) => page.posts) ?? [],
    [repliedQuery.data]
  );

  if (isLoading) {
    return <ProfileSkeleton />;
  }

  if (!profile) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Profil tidak ditemukan.</p>
      </div>
    );
  }

  const initials =
    profile.full_name
      ?.split(' ')
      .map((name) => name[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'US';

  const roleLabel = getProfileRoleLabel(profile);
  const verificationState = getProfileVerificationState(profile);
  const isVerified = isProfileVerified(profile);
  const trustBadge = getTrustBadge(profile);
  const location = getProfileLocation(profile);
  const age = getProfileAge(profile);
  const showAge = shouldShowProfileAge(profile);
  const canChatFromProfile = canReceiveProfileChat(profile);
  const canInviteToMass = canReceiveMassInvite(profile);
  const baptismName = profile.baptism_name?.trim();
  const requestedTab = searchParams.get('tab');
  const initialTab = requestedTab === 'shared' || requestedTab === 'replies' ? requestedTab : 'posts';

  const handleShareProfile = async () => {
    try {
      const profileUrl = `${window.location.origin}/profile/${profile.id}`;
      if (navigator.share) {
        await navigator.share({
          title: `${profile.full_name || 'User'} • MyCatholic`,
          text: 'Lihat profil ini di MyCatholic',
          url: profileUrl,
        });
      } else {
        await navigator.clipboard.writeText(profileUrl);
        toast.success('Link profil disalin');
      }
    } catch (error) {
      const text = error?.toString().toLowerCase() ?? '';
      if (text.includes('abort')) return;
      toast.error('Gagal membagikan profil');
    }
  };

  const handleStartChat = async () => {
    if (!canChatFromProfile) {
      toast.info('Pengguna ini menonaktifkan chat dari profil.');
      return;
    }

    try {
      const chat = await createChat({ otherUserId: profile.id });
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal membuka chat');
    }
  };

  const handleInviteMass = () => {
    router.push(
      `/radar?tab=ajak&targetId=${encodeURIComponent(profile.id)}&targetName=${encodeURIComponent(
        profile.full_name || ''
      )}`
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 sm:space-y-6">
      <Card className="overflow-hidden border-primary/20 bg-card shadow-sm">
        <CardContent className="p-0">
          <div className="relative aspect-[5/1] w-full overflow-hidden signature-gradient">
            {profile.banner_url ? (
              <img
                src={profile.banner_url}
                alt={`Banner ${profile.full_name || 'User'}`}
                className="h-full w-full object-cover"
              />
            ) : null}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/20" />
          </div>

          <div className="relative px-4 pb-6 sm:px-8 sm:pb-7">
            <Avatar className="absolute -top-11 left-4 h-24 w-24 border-4 border-background shadow-lg ring-1 ring-border/60 sm:-top-14 sm:left-8 sm:h-32 sm:w-32">
              <AvatarImage src={profile.avatar_url} alt={profile.full_name || ''} />
              <AvatarFallback className="text-xl font-bold">{initials}</AvatarFallback>
            </Avatar>

            <div className="pt-6 sm:pt-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 pl-28 sm:pl-40">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-bold sm:text-2xl">{profile.full_name || 'User'}</h1>
                    <Badge variant="secondary">{roleLabel}</Badge>
                    <Badge className={trustBadgeClassName(trustBadge.tone)}>
                      {isVerified && <Star className="mr-1 h-3 w-3" />}
                      {trustBadge.label}
                    </Badge>
                    {showAge && age != null && <Badge variant="outline">Umur {age}</Badge>}
                  </div>

                  {baptismName && (
                    <p className="mt-1 text-xs text-muted-foreground sm:text-sm">Nama Baptis: {baptismName}</p>
                  )}

                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{location.line1}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
                    <Church className="h-3.5 w-3.5" />
                    <span>{location.line2}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 self-start sm:pt-1">
                  {isOwnProfile ? (
                    <>
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="rounded-xl border-border/70 transition-transform hover:-translate-y-0.5"
                      >
                        <Link href="/profile/edit">Edit Profil</Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-xl border-border/70 transition-transform hover:-translate-y-0.5"
                        onClick={handleShareProfile}
                        aria-label="Bagikan profil"
                      >
                        <Share2 className="h-5 w-5" />
                      </Button>
                      <Button
                        asChild
                        variant="outline"
                        size="icon"
                        className="rounded-xl border-border/70 transition-transform hover:-translate-y-0.5"
                        aria-label="Pengaturan"
                      >
                        <Link href="/settings">
                          <Settings className="h-5 w-5" />
                        </Link>
                      </Button>
                    </>
                  ) : (
                    <>
                      <FollowButton
                        profileId={profile.id}
                        isFollowing={isFollowing}
                        onFollow={follow}
                        onUnfollow={unfollow}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl border-border/70 transition-transform hover:-translate-y-0.5"
                        disabled={isCreatingChat}
                        onClick={handleStartChat}
                      >
                        {isCreatingChat ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Membuka...
                          </>
                        ) : (
                          <>
                            <MessageSquare className="mr-2 h-4 w-4" />
                            Chat
                          </>
                        )}
                      </Button>
                      {canInviteToMass && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl border-border/70 transition-transform hover:-translate-y-0.5"
                          onClick={handleInviteMass}
                        >
                          <CalendarPlus className="mr-2 h-4 w-4" />
                          Ajak Misa
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-xl border-border/70 transition-transform hover:-translate-y-0.5"
                        onClick={handleShareProfile}
                        aria-label="Bagikan profil"
                      >
                        <Share2 className="h-5 w-5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {isOwnProfile && !isVerified && (
              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2">
                    {verificationState === 'pending' ? (
                      <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    )}
                    <div className="flex-1 text-sm">
                      {verificationState === 'pending' ? (
                        <p className="text-muted-foreground">
                          Dokumen verifikasi sedang direview admin. Mohon tunggu persetujuan.
                        </p>
                      ) : verificationState === 'rejected' ? (
                        <p className="text-muted-foreground">
                          Verifikasi Anda ditolak. Silakan unggah ulang dokumen melalui menu verifikasi akun.
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          Lengkapi verifikasi untuk meningkatkan trust profil Anda.
                        </p>
                      )}
                    </div>
                  </div>
                  {verificationState !== 'pending' && (
                    <Button
                      asChild
                      size="sm"
                      className="inline-flex shrink-0 rounded-xl bg-primary font-medium transition-transform hover:-translate-y-0.5 hover:bg-primary-hover"
                    >
                      <Link href="/settings/verification">Buka Verifikasi Akun</Link>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {profile.bio && (
              <p className="mt-4 max-w-3xl text-sm text-muted-foreground">{profile.bio}</p>
            )}

            <div className="mt-5 grid w-full max-w-md grid-cols-3 gap-2 sm:gap-3">
              <StatItem label="Posts" value={stats.posts_count} />
              <Link
                href={`/profile/${profile.id}/followers`}
                className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <StatItem label="Followers" value={stats.followers_count} className="group-hover:border-primary/30 group-hover:bg-primary/5" />
              </Link>
              <Link
                href={`/profile/${profile.id}/following`}
                className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <StatItem label="Following" value={stats.following_count} className="group-hover:border-primary/30 group-hover:bg-primary/5" />
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList className={cn('grid h-auto w-full max-w-xl grid-cols-3 rounded-xl border border-border/70 bg-card p-1 shadow-sm')}>
          <TabsTrigger
            value="posts"
            className="h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Posts
          </TabsTrigger>
          <TabsTrigger
            value="shared"
            className="h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Dibagikan
          </TabsTrigger>
          <TabsTrigger
            value="replies"
            className="h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            Balasan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="mt-5 space-y-4">
          {postsQuery.isLoading ? (
            <ProfileFeedSkeleton />
          ) : userPosts.length === 0 ? (
            <EmptyState
              icon={<Calendar className="h-8 w-8 text-muted-foreground" />}
              title={isOwnProfile ? 'Belum ada postingan' : 'User belum memposting'}
              description="Postingan baru akan muncul di sini."
            />
          ) : (
            <>
              {userPosts.map((post) => (
                <PostCard key={post.id} post={post} onClick={() => router.push(`/post/${post.id}`)} />
              ))}

              {postsQuery.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => postsQuery.fetchNextPage()}
                    disabled={postsQuery.isFetchingNextPage}
                    className="rounded-full border-border/70 transition-transform hover:-translate-y-0.5"
                  >
                    {postsQuery.isFetchingNextPage ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Memuat...
                      </>
                    ) : (
                      'Muat lebih banyak'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="shared" className="mt-5 space-y-4">
          {sharedQuery.isLoading ? (
            <ProfileFeedSkeleton />
          ) : sharedPosts.length === 0 ? (
            <EmptyState
              icon={<Repeat2 className="h-8 w-8 text-muted-foreground" />}
              title={isOwnProfile ? 'Belum ada post yang dibagikan' : 'User belum membagikan post'}
              description="Post yang dibagikan akan tampil di sini."
            />
          ) : (
            <>
              {sharedPosts.map((post) => (
                <PostCard key={post.id} post={post} onClick={() => router.push(`/post/${post.id}`)} />
              ))}

              {sharedQuery.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => sharedQuery.fetchNextPage()}
                    disabled={sharedQuery.isFetchingNextPage}
                    className="rounded-full border-border/70 transition-transform hover:-translate-y-0.5"
                  >
                    {sharedQuery.isFetchingNextPage ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Memuat...
                      </>
                    ) : (
                      'Muat lebih banyak'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="replies" className="mt-5 space-y-4">
          {repliedQuery.isLoading ? (
            <ProfileFeedSkeleton />
          ) : repliedPosts.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-8 w-8 text-muted-foreground" />}
              title={isOwnProfile ? 'Belum ada balasan' : 'User belum membalas post'}
              description="Post yang pernah dibalas akan tampil di sini."
            />
          ) : (
            <>
              {repliedPosts.map((post) => (
                <PostCard key={post.id} post={post} onClick={() => router.push(`/post/${post.id}`)} />
              ))}

              {repliedQuery.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => repliedQuery.fetchNextPage()}
                    disabled={repliedQuery.isFetchingNextPage}
                    className="rounded-full border-border/70 transition-transform hover:-translate-y-0.5"
                  >
                    {repliedQuery.isFetchingNextPage ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Memuat...
                      </>
                    ) : (
                      'Muat lebih banyak'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function trustBadgeClassName(tone: 'success' | 'primary' | 'warning' | 'danger' | 'muted') {
  if (tone === 'success') return 'bg-success/90 text-white';
  if (tone === 'primary') return 'bg-primary/15 text-primary border border-primary/30';
  if (tone === 'warning') return 'bg-amber-500/15 text-amber-600 border border-amber-500/30';
  if (tone === 'danger') return 'bg-destructive/15 text-destructive border border-destructive/30';
  return 'bg-muted text-muted-foreground border border-border/70';
}

function StatItem({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-center transition-all', className)}>
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function FollowButton({
  profileId,
  isFollowing,
  onFollow,
  onUnfollow,
}: {
  profileId: string;
  isFollowing: boolean;
  onFollow: (id: string) => Promise<void>;
  onUnfollow: (id: string) => Promise<void>;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleFollow = async () => {
    if (isLoading) return;
    try {
      setIsLoading(true);
      if (isFollowing) {
        await onUnfollow(profileId);
      } else {
        await onFollow(profileId);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleFollow}
      disabled={isLoading}
      variant={isFollowing ? 'outline' : 'default'}
      size="sm"
      className={cn(
        'rounded-xl border-border/70 transition-transform hover:-translate-y-0.5',
        isFollowing ? '' : 'bg-primary hover:bg-primary-hover'
      )}
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isFollowing ? 'Following' : 'Follow'}
    </Button>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-border/70 bg-card p-10 text-center shadow-sm">
      <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-muted">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </Card>
  );
}

function ProfileFeedSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 2 }).map((_, index) => (
        <Card key={index} className="overflow-hidden border-border/70 bg-card shadow-sm">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-60 w-full rounded-xl" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Card className="overflow-hidden border-border/70 bg-card shadow-sm">
        <CardContent className="p-0">
          <Skeleton className="aspect-[5/1] w-full" />
          <div className="px-4 pb-7 sm:px-8">
            <div className="-mt-11 flex items-end gap-4 sm:-mt-14">
              <Skeleton className="h-24 w-24 rounded-full border-4 border-border sm:h-32 sm:w-32" />
              <div className="space-y-2 pb-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
            <Skeleton className="mt-4 h-4 w-3/4" />
            <div className="mt-5 grid max-w-md grid-cols-3 gap-2 sm:gap-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          </div>
        </CardContent>
      </Card>
      <ProfileFeedSkeleton />
    </div>
  );
}
