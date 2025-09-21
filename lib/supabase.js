import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Auth functions
export const signUp = async (email, password, userType = 'citizen', profileData = {}, locationData = {}) => {
  try {
    console.log('Starting signup process...', { email, userType, profileData, locationData });

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          user_type: userType,
          full_name: profileData.fullName,
        }
      }
    });

    if (authError) {
      console.error('Auth signup error:', authError);
      return { error: authError };
    }

    if (!authData.user) {
      return { error: { message: 'No user returned from signup' } };
    }

    console.log('Auth user created:', authData.user.id);

    // Create profile
    const profilePayload = {
      id: authData.user.id,
      email: email.toLowerCase(),
      user_type: userType,
      full_name: profileData.fullName || '',
      first_name: profileData.fullName?.split(' ')[0] || '',
      last_name: profileData.fullName?.split(' ').slice(1).join(' ') || '',
      phone: profileData.phone || '',
      address: profileData.address || '',
      city: profileData.city || '',
      state: profileData.state || '',
      postal_code: profileData.postalCode || '',
      assigned_area_id: locationData.areaId || null,
      assigned_department_id: locationData.departmentId || null,
      is_verified: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Creating profile with payload:', profilePayload);

    const { data: profileResult, error: profileError } = await supabase
      .from('profiles')
      .insert([profilePayload])
      .select()
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError);
      // Try to clean up auth user if profile creation fails
      try {
        await supabase.auth.admin.deleteUser(authData.user.id);
      } catch (cleanupError) {
        console.error('Failed to cleanup auth user:', cleanupError);
      }
      return { error: profileError };
    }

    console.log('Profile created successfully:', profileResult);

    return { 
      data: { 
        user: authData.user, 
        profile: profileResult 
      }, 
      error: null 
    };

  } catch (error) {
    console.error('Signup process error:', error);
    return { error: { message: error.message || 'Signup failed' } };
  }
};

export const signIn = async (email, password) => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });

    if (error) {
      return { error };
    }

    // Update last login
    if (data.user) {
      await supabase
        .from('profiles')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', data.user.id);
    }

    return { data, error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

export const getCurrentUser = async () => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    return { user, error };
  } catch (error) {
    return { user: null, error };
  }
};

export const resetPassword = async (email) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'exp://localhost:8081/reset-password',
  });
  return { error };
};

export const updatePassword = async (password) => {
  const { error } = await supabase.auth.updateUser({ password });
  return { error };
};

// Profile functions
export const getUserProfile = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        *,
        assigned_area:assigned_area_id (
          id,
          name,
          code,
          description
        ),
        assigned_department:assigned_department_id (
          id,
          name,
          code,
          category,
          description
        )
      `)
      .eq('id', userId)
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

export const updateUserProfile = async (userId, updates) => {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select()
    .single();

  return { data, error };
};

export const updateUserPoints = async (userId, action, points) => {
  try {
    // Get current points
    const { data: profile } = await supabase
      .from('profiles')
      .select('points')
      .eq('id', userId)
      .single();

    const currentPoints = profile?.points || 0;
    const newPoints = currentPoints + points;

    const { data, error } = await supabase
      .from('profiles')
      .update({ 
        points: newPoints,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    return { data, error };
  } catch (error) {
    return { error };
  }
};

export const uploadAvatar = async (imageUri, userId) => {
  try {
    const fileExt = imageUri.split('.').pop();
    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    // Convert image to blob for upload
    const response = await fetch(imageUri);
    const blob = await response.blob();

    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(filePath, blob);

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    // Update profile with avatar URL
    await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId);

    return { data: { url: publicUrl }, error: null };
  } catch (error) {
    return { data: null, error };
  }
};

export const updateNotificationSettings = async (userId, settings) => {
  const { data, error } = await supabase
    .from('profiles')
    .update({ 
      notification_settings: settings,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  return { data, error };
};

// Location functions
export const getStates = async () => {
  try {
    const { data, error } = await supabase
      .from('states')
      .select('*')
      .eq('is_active', true)
      .order('name');

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

export const getDistrictsByState = async (stateId) => {
  try {
    const { data, error } = await supabase
      .from('districts')
      .select('*')
      .eq('state_id', stateId)
      .eq('is_active', true)
      .order('name');

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

export const getAreasByDistrict = async (districtId) => {
  try {
    const { data, error } = await supabase
      .from('areas')
      .select('*')
      .eq('district_id', districtId)
      .eq('is_active', true)
      .order('name');

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

export const getAreas = async () => {
  try {
    const { data, error } = await supabase
      .from('areas')
      .select('*')
      .eq('is_active', true)
      .order('name');

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

export const getDepartments = async () => {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('is_active', true)
      .order('name');

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

// Issue functions
export const createIssue = async (issueData) => {
  try {
    const { data, error } = await supabase
      .from('issues')
      .insert([{
        ...issueData,
        workflow_stage: 'reported',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

export const getIssues = async (filters = {}) => {
  try {
    let query = supabase
      .from('issues')
      .select(`
        *,
        profiles:user_id (
          full_name,
          first_name,
          user_type,
          email
        ),
        current_assignee:current_assignee_id (
          full_name,
          user_type
        ),
        assigned_area:assigned_area_id (
          name,
          code
        ),
        assigned_department:assigned_department_id (
          name,
          code,
          category
        )
      `)
      .order('created_at', { ascending: false });

    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }
    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    if (filters.area) {
      query = query.eq('area', filters.area);
    }
    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom);
    }

    const { data, error } = await query;
    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

export const getIssueById = async (issueId) => {
  try {
    const { data, error } = await supabase
      .from('issues')
      .select(`
        *,
        profiles:user_id (
          full_name,
          first_name,
          email,
          user_type
        ),
        assignments:issue_assignments (
          id,
          assignment_type,
          assignment_notes,
          status,
          created_at,
          assigned_by_profile:assigned_by (
            full_name,
            user_type
          ),
          assigned_to_profile:assigned_to (
            full_name,
            user_type
          )
        )
      `)
      .eq('id', issueId)
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

export const getUserIssues = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('issues')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

export const updateIssue = async (issueId, updates) => {
  const { data, error } = await supabase
    .from('issues')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', issueId)
    .select()
    .single();

  return { data, error };
};

export const getIssuesWithLocation = async (filters = {}) => {
  try {
    let query = supabase
      .from('issues')
      .select(`
        *,
        profiles:user_id (
          full_name,
          user_type
        )
      `)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('created_at', { ascending: false });

    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }
    if (filters.area && filters.area !== 'all') {
      query = query.eq('area', filters.area);
    }
    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom);
    }

    const { data, error } = await query;
    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

// Issue voting functions
export const voteOnIssue = async (issueId, voteType) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Check if user already voted
    const { data: existingVote } = await supabase
      .from('issue_votes')
      .select('*')
      .eq('issue_id', issueId)
      .eq('user_id', user.id)
      .single();

    if (existingVote) {
      if (existingVote.vote_type === voteType) {
        // Remove vote if same type
        const { error } = await supabase
          .from('issue_votes')
          .delete()
          .eq('id', existingVote.id);
        return { data: null, error };
      } else {
        // Update vote type
        const { data, error } = await supabase
          .from('issue_votes')
          .update({ vote_type: voteType })
          .eq('id', existingVote.id)
          .select()
          .single();
        return { data, error };
      }
    } else {
      // Create new vote
      const { data, error } = await supabase
        .from('issue_votes')
        .insert([{
          issue_id: issueId,
          user_id: user.id,
          vote_type: voteType
        }])
        .select()
        .single();
      return { data, error };
    }
  } catch (error) {
    return { data: null, error };
  }
};

export const getUserVote = async (issueId) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: null };

    const { data, error } = await supabase
      .from('issue_votes')
      .select('*')
      .eq('issue_id', issueId)
      .eq('user_id', user.id)
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

// Community functions
export const getCommunityFeed = async (filters = {}) => {
  try {
    // Get issues
    let issuesQuery = supabase
      .from('issues')
      .select(`
        *,
        profiles:user_id (
          full_name,
          first_name,
          user_type,
          email
        )
      `)
      .order('created_at', { ascending: false });

    if (filters.category && filters.category !== 'all') {
      issuesQuery = issuesQuery.eq('category', filters.category);
    }
    if (filters.status && filters.status !== 'all') {
      issuesQuery = issuesQuery.eq('status', filters.status);
    }
    if (filters.location) {
      issuesQuery = issuesQuery.ilike('location_name', `%${filters.location}%`);
    }

    // Get community posts
    let postsQuery = supabase
      .from('community_posts')
      .select(`
        *,
        profiles:user_id (
          full_name,
          first_name,
          user_type,
          email
        )
      `)
      .order('created_at', { ascending: false });

    const [issuesResult, postsResult] = await Promise.all([
      issuesQuery,
      postsQuery
    ]);

    // Combine and format data
    const issues = (issuesResult.data || []).map(issue => ({
      ...issue,
      type: 'issue',
      content: issue.description
    }));

    const posts = (postsResult.data || []).map(post => ({
      ...post,
      type: 'post'
    }));

    const combinedData = [...issues, ...posts].sort((a, b) => 
      new Date(b.created_at) - new Date(a.created_at)
    );

    return { data: combinedData, error: null };
  } catch (error) {
    return { data: [], error };
  }
};

export const getPosts = async () => {
  try {
    const { data, error } = await supabase
      .from('community_posts')
      .select(`
        *,
        profiles:user_id (
          full_name,
          user_type
        )
      `)
      .order('created_at', { ascending: false });

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

// Tender functions
export const getTenders = async (status = 'available') => {
  try {
    let query = supabase
      .from('tenders')
      .select(`
        *,
        posted_by_profile:posted_by (
          full_name,
          user_type
        ),
        awarded_to_profile:awarded_to (
          full_name,
          user_type
        ),
        bids:bids (
          id,
          amount,
          status,
          user_id
        )
      `)
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

export const createTender = async (tenderData) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('tenders')
      .insert([{
        ...tenderData,
        posted_by: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

export const getUserBids = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('bids')
      .select(`
        *,
        tender:tender_id (
          title,
          status,
          deadline_date
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

export const createBid = async (bidData) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('bids')
      .insert([{
        ...bidData,
        user_id: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

// Feedback functions
export const createFeedback = async (feedbackData) => {
  try {
    const { data, error } = await supabase
      .from('feedback')
      .insert([{
        ...feedbackData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

export const getUserFeedback = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

// Municipal officials functions
export const getMunicipalOfficials = async () => {
  try {
    const { data, error } = await supabase
      .from('municipal_officials')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('name');

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

// Notification functions
export const getUserNotifications = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

// Leaderboard functions
export const getLeaderboard = async (period = 'month') => {
  try {
    let dateFilter = '';
    const now = new Date();
    
    switch (period) {
      case 'week':
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case 'month':
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case 'quarter':
        dateFilter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case 'year':
        dateFilter = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
        break;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        first_name,
        user_type,
        points,
        avatar_url,
        created_at
      `)
      .gte('created_at', dateFilter)
      .order('points', { ascending: false })
      .limit(100);

    // Add computed fields
    const enhancedData = (data || []).map((user, index) => ({
      ...user,
      total_score: user.points || 0,
      issues_reported: 0, // Will be computed separately if needed
      posts_created: 0,   // Will be computed separately if needed
      badges: [],         // Will be computed based on achievements
      rank: index + 1,
      level: Math.floor((user.points || 0) / 100) + 1
    }));

    return { data: enhancedData, error };
  } catch (error) {
    return { data: [], error };
  }
};

// Admin functions
export const getAdminDashboardStats = async () => {
  try {
    const [issuesResult, usersResult, tendersResult] = await Promise.all([
      supabase.from('issues').select('id, status, created_at'),
      supabase.from('profiles').select('id, created_at, last_login_at'),
      supabase.from('tenders').select('id, status')
    ]);

    const issues = issuesResult.data || [];
    const users = usersResult.data || [];
    const tenders = tendersResult.data || [];

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const stats = {
      total_issues: issues.length,
      pending_issues: issues.filter(i => i.status === 'pending').length,
      in_progress_issues: issues.filter(i => i.status === 'in_progress').length,
      resolved_issues: issues.filter(i => i.status === 'resolved').length,
      recent_issues: issues.filter(i => new Date(i.created_at) > weekAgo).length,
      resolution_rate: issues.length > 0 ? Math.round((issues.filter(i => i.status === 'resolved').length / issues.length) * 100) : 0,
      active_users: users.filter(u => u.last_login_at && new Date(u.last_login_at) > weekAgo).length,
      active_tenders: tenders.filter(t => t.status === 'available').length,
      response_time: '3 days' // Placeholder - can be computed from actual data
    };

    return { data: stats, error: null };
  } catch (error) {
    return { data: {}, error };
  }
};

// Assignment functions
export const assignIssueToDepart = async (issueId, departmentId, notes = '') => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Update issue
    const { error: updateError } = await supabase
      .from('issues')
      .update({
        assigned_department_id: departmentId,
        workflow_stage: 'department_assigned',
        status: 'acknowledged',
        updated_at: new Date().toISOString()
      })
      .eq('id', issueId);

    if (updateError) throw updateError;

    // Create assignment record
    const { data, error } = await supabase
      .from('issue_assignments')
      .insert([{
        issue_id: issueId,
        assigned_by: user.id,
        assigned_to: departmentId,
        assignment_type: 'department',
        assignment_notes: notes,
        status: 'active',
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

export const assignIssueToDepartment = async (issueId, departmentId, notes = '') => {
  return assignIssueToDepart(issueId, departmentId, notes);
};

// Workflow stage functions
export const getIssuesByWorkflowStage = async (stage, areaId = null, departmentId = null) => {
  try {
    let query = supabase
      .from('issues')
      .select(`
        *,
        profiles:user_id (
          full_name,
          first_name,
          user_type,
          email
        ),
        current_assignee:current_assignee_id (
          full_name,
          user_type
        ),
        assignments:issue_assignments (
          id,
          assignment_type,
          assignment_notes,
          status,
          created_at,
          assigned_by_profile:assigned_by (
            full_name,
            user_type
          )
        )
      `)
      .eq('workflow_stage', stage)
      .order('created_at', { ascending: false });

    if (areaId) {
      query = query.eq('assigned_area_id', areaId);
    }
    if (departmentId) {
      query = query.eq('assigned_department_id', departmentId);
    }

    const { data, error } = await query;
    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

// Dashboard functions for different admin types
export const getAreaSuperAdminDashboard = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data: profile } = await getUserProfile(user.id);
    const areaId = profile?.data?.assigned_area_id;

    const [issuesResult, departmentsResult] = await Promise.all([
      supabase
        .from('issues')
        .select(`
          *,
          profiles:user_id (
            full_name,
            user_type
          )
        `)
        .eq('assigned_area_id', areaId)
        .order('created_at', { ascending: false }),
      
      supabase
        .from('departments')
        .select('*')
        .eq('area_id', areaId)
        .eq('is_active', true)
    ]);

    return {
      data: {
        issues: issuesResult.data || [],
        departments: departmentsResult.data || [],
        areaId
      },
      error: null
    };
  } catch (error) {
    return { data: { issues: [], departments: [], areaId: null }, error };
  }
};

export const getDepartmentAdminDashboard = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data: profile } = await getUserProfile(user.id);
    const departmentId = profile?.data?.assigned_department_id;

    const [issuesResult, tendersResult, contractorsResult] = await Promise.all([
      supabase
        .from('issues')
        .select(`
          *,
          profiles:user_id (
            full_name,
            user_type
          )
        `)
        .eq('assigned_department_id', departmentId)
        .order('created_at', { ascending: false }),
      
      supabase
        .from('tenders')
        .select(`
          *,
          bids:bids (
            id,
            amount,
            status
          )
        `)
        .eq('department_id', departmentId)
        .order('created_at', { ascending: false }),

      supabase
        .from('profiles')
        .select('*')
        .eq('user_type', 'tender')
        .eq('is_verified', true)
    ]);

    return {
      data: {
        issues: issuesResult.data || [],
        tenders: tendersResult.data || [],
        contractors: contractorsResult.data || [],
        departmentId
      },
      error: null
    };
  } catch (error) {
    return { data: { issues: [], tenders: [], contractors: [], departmentId: null }, error };
  }
};

// Real-time subscriptions
export const subscribeToIssueUpdates = (callback) => {
  return supabase
    .channel('issue_updates')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'issues' }, 
      callback
    )
    .subscribe();
};

export const subscribeToAssignmentUpdates = (callback) => {
  return supabase
    .channel('assignment_updates')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'issue_assignments' }, 
      callback
    )
    .subscribe();
};

export const subscribeToTenderUpdates = (callback) => {
  return supabase
    .channel('tender_updates')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'tenders' }, 
      callback
    )
    .subscribe();
};

// Email verification functions
export const sendVerificationEmail = async (email) => {
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
    });
    return { error };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

export const verifyEmail = async (token) => {
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: 'email'
    });
    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

// Work progress functions
export const getWorkProgress = async (tenderId) => {
  try {
    const { data, error } = await supabase
      .from('work_progress')
      .select('*')
      .eq('tender_id', tenderId)
      .order('created_at', { ascending: false });

    return { data, error };
  } catch (error) {
    return { data: [], error };
  }
};

export const assignTenderToContractor = async (tenderId, contractorId) => {
  try {
    const { data, error } = await supabase
      .from('tenders')
      .update({
        awarded_to: contractorId,
        status: 'awarded',
        awarded_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', tenderId)
      .select()
      .single();

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
};

export default supabase;