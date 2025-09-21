import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Constants
const ALLOWED_USER_TYPES = ['citizen', 'area_super_admin', 'department_admin', 'contractor', 'admin'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Error handling utility
const handleError = (error, context = '') => {
  console.error(`${context} error:`, error);
  return {
    data: null,
    error: {
      message: error?.message || 'An unexpected error occurred',
      code: error?.code || 'UNKNOWN_ERROR',
      details: error
    }
  };
};

// Success response utility
const handleSuccess = (data, message = null) => ({
  data,
  error: null,
  message
});

// Input validation utilities
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePhone = (phone) => {
  const phoneRegex = /^[+]?[\d\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone);
};

const validateUserType = (userType) => {
  return ALLOWED_USER_TYPES.includes(userType);
};

// Auth functions
export const signUp = async (email, password, userType, profileData, locationData) => {
  try {
    console.log('Starting signup process...');

    // Validate inputs
    if (!email || !validateEmail(email)) {
      return handleError({ message: 'Valid email is required' }, 'Validation');
    }

    if (!password || password.length < 8) {
      return handleError({ message: 'Password must be at least 8 characters long' }, 'Validation');
    }

    if (!validateUserType(userType)) {
      return handleError({ message: 'Invalid user type' }, 'Validation');
    }

    // Sign up with Supabase Auth
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
      return handleError(authError, 'Auth signup');
    }

    if (!authData.user) {
      return handleError({ message: 'No user data returned from signup' }, 'Signup');
    }

    console.log('User created:', authData.user.id);

    // Create profile record
    const profilePayload = {
      user_id: authData.user.id,
      full_name: profileData.fullName,
      email: email,
      phone: profileData.phone || null,
      user_type: userType,
      assigned_area_id: locationData?.areaId || null,
      assigned_department_id: locationData?.departmentId || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Add optional address fields if they exist
    if (profileData.address) profilePayload.address = profileData.address;
    if (profileData.city) profilePayload.city = profileData.city;
    if (profileData.state) profilePayload.state = profileData.state;
    if (profileData.postalCode) profilePayload.postal_code = profileData.postalCode;

    console.log('Creating profile with payload:', profilePayload);

    const { data: profileDataResponse, error: profileError } = await supabase
      .from('profiles')
      .insert(profilePayload)
      .select()
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError);

      // If profile creation fails, we still return the auth data
      // but log the error for debugging
      return handleSuccess({
        user: authData.user,
        profile: null,
        profileError: profileError.message
      }, 'User created but profile creation failed');
    }

    console.log('Profile created successfully:', profileDataResponse);

    return handleSuccess({
      user: authData.user,
      profile: profileDataResponse
    }, 'Account created successfully');

  } catch (error) {
    console.error('Signup error:', error);
    return handleError(error, 'Signup');
  }
};

export const signIn = async (email, password) => {
  try {
    if (!email || !validateEmail(email)) {
      return handleError({ message: 'Valid email is required' }, 'Validation');
    }

    if (!password) {
      return handleError({ message: 'Password is required' }, 'Validation');
    }

    console.log('Attempting sign in for email:', email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return handleError(error, 'Sign in');
    }

    if (!data.user) {
      return handleError({ message: 'No user data returned' }, 'Sign in');
    }

    console.log('Sign in successful, fetching profile...');

    // Fetch user profile after successful authentication
    try {
      const { data: profile, error: profileError } = await getUserProfile(data.user.id);

      // Even if profile fetch fails, we still return successful login
      return handleSuccess({
        ...data,
        profile: profile || null,
        profileError: profileError?.message || null
      }, 'Signed in successfully');

    } catch (profileFetchError) {
      console.error('Profile fetch exception:', profileFetchError);
      return handleSuccess({
        ...data,
        profile: null,
        profileError: 'Failed to fetch profile'
      }, 'Signed in successfully (profile fetch failed)');
    }
  } catch (error) {
    return handleError(error, 'Sign in');
  }
};

export const createMissingProfile = async (userId) => {
  try {
    // Get user details from auth
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    // Check if profile already exists
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existingProfile) {
      return handleSuccess(existingProfile, 'Profile already exists');
    }

    // Create new profile
    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert({
        user_id: userId,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        email: user.email,
        user_type: user.user_metadata?.user_type || 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) {
      return handleError(createError, 'Create missing profile');
    }

    return handleSuccess(newProfile, 'Profile created successfully');
  } catch (error) {
    return handleError(error, 'Create missing profile');
  }
};

// 5. Add a function to check and fix profile data integrity
export const checkProfileIntegrity = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    // Check if profile exists
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      return handleError(profileError, 'Profile integrity check');
    }

    if (!profile) {
      // Profile doesn't exist, create it
      console.log('Profile missing, creating...');
      return await createMissingProfile(user.id);
    }

    // Profile exists, check if it needs updates
    const updates = {};

    if (!profile.email && user.email) {
      updates.email = user.email;
    }

    if (!profile.full_name && user.user_metadata?.full_name) {
      updates.full_name = user.user_metadata.full_name;
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();

      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) {
        return handleError(updateError, 'Profile update');
      }

      return handleSuccess(updatedProfile, 'Profile updated');
    }

    return handleSuccess(profile, 'Profile is up to date');
  } catch (error) {
    return handleError(error, 'Profile integrity check');
  }
};
export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return handleError(error, 'Sign out');
    }
    return handleSuccess(null, 'Signed out successfully');
  } catch (error) {
    return handleError(error, 'Sign out');
  }
};

export const getCurrentUser = async () => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      return handleError(error, 'Get current user');
    }
    return handleSuccess(user);
  } catch (error) {
    return handleError(error, 'Get current user');
  }
};

export const resetPassword = async (email) => {
  try {
    if (!email || !validateEmail(email)) {
      return handleError({ message: 'Valid email is required' }, 'Validation');
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      return handleError(error, 'Password reset');
    }

    return handleSuccess(null, 'Password reset email sent');
  } catch (error) {
    return handleError(error, 'Password reset');
  }
};

export const updatePassword = async (password) => {
  try {
    if (!password || password.length < 8) {
      return handleError({ message: 'Password must be at least 8 characters long' }, 'Validation');
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return handleError(error, 'Password update');
    }

    return handleSuccess(null, 'Password updated successfully');
  } catch (error) {
    return handleError(error, 'Password update');
  }
};

// Profile functions
export const getUserProfile = async (userId) => {
  try {
    if (!userId) {
      return { data: null, error: { message: 'User ID is required' } };
    }

    console.log('Fetching profile for user ID:', userId);

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(); // returns object or null

    if (error) {
      console.error('Profile fetch error:', error);
      return { data: null, error };
    }

    if (data) {
      console.log('Profile found:', data);
      return { data, error: null };
    }

    // No profile found → create one automatically
    console.log('No profile found, creating default profile...');

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { data: null, error: { message: 'Failed to get user details from auth' } };
    }

    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert({
        user_id: userId,
        full_name: user.user_metadata?.full_name || user.email.split('@')[0],
        email: user.email,
        user_type: user.user_metadata?.user_type || 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single(); // ensures object returned

    if (createError) {
      console.error('Failed to create profile:', createError);
      return { data: null, error: createError };
    }

    console.log('Created new profile:', newProfile);
    return { data: newProfile, error: null };

  } catch (error) {
    console.error('Get user profile error:', error);
    return { data: null, error };
  }
};


export const updateUserProfile = async (userId, updates) => {
  try {
    if (!userId) {
      return handleError({ message: 'User ID is required' }, 'Validation');
    }

    // Validate updates
    if (updates.email && !validateEmail(updates.email)) {
      return handleError({ message: 'Invalid email format' }, 'Validation');
    }

    if (updates.phone && !validatePhone(updates.phone)) {
      return handleError({ message: 'Invalid phone format' }, 'Validation');
    }

    if (updates.user_type && !validateUserType(updates.user_type)) {
      return handleError({ message: 'Invalid user type' }, 'Validation');
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return handleError(error, 'Update user profile');
    }

    return handleSuccess(data, 'Profile updated successfully');
  } catch (error) {
    return handleError(error, 'Update user profile');
  }
};

export const updateUserPoints = async (userId, action, points) => {
  try {
    if (!userId || !action || points === undefined) {
      return handleError({ message: 'Missing required parameters' }, 'Validation');
    }

    if (typeof points !== 'number' || points < 0) {
      return handleError({ message: 'Points must be a positive number' }, 'Validation');
    }

    const { data, error } = await supabase.rpc('update_user_points', {
      user_id_param: userId,
      action_type_param: action,
      points_to_add_param: points,
    });

    if (error) {
      return handleError(error, 'Update user points');
    }

    return handleSuccess(data, 'Points updated successfully');
  } catch (error) {
    return handleError(error, 'Update user points');
  }
};

// Areas and Departments
export const getAreas = async () => {
  try {
    const { data, error } = await supabase
      .from('areas')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      return handleError(error, 'Get areas');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get areas');
  }
};

export const getDepartments = async (areaId = null) => {
  try {
    let query = supabase
      .from('departments')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (areaId) {
      query = query.eq('area_id', areaId);
    }

    const { data, error } = await query;

    if (error) {
      return handleError(error, 'Get departments');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get departments');
  }
};

export const getWards = async () => {
  try {
    const { data, error } = await supabase
      .from('issues')
      .select('ward')
      .not('ward', 'is', null);

    if (error) {
      return handleError(error, 'Get wards');
    }

    const uniqueWards = [...new Set(data?.map(item => item.ward).filter(Boolean))];
    return handleSuccess(uniqueWards);
  } catch (error) {
    return handleError(error, 'Get wards');
  }
};

// Issues functions
export const createIssue = async (issueData) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    // Validate required fields
    if (!issueData.title || !issueData.description || !issueData.category) {
      return handleError({ message: 'Title, description, and category are required' }, 'Validation');
    }

    if (issueData.title.length < 5 || issueData.title.length > 200) {
      return handleError({ message: 'Title must be between 5 and 200 characters' }, 'Validation');
    }

    if (issueData.description.length < 10 || issueData.description.length > 2000) {
      return handleError({ message: 'Description must be between 10 and 2000 characters' }, 'Validation');
    }

    const payload = {
      ...issueData,
      user_id: user.id,
      status: 'pending',
      priority: issueData.priority || 'medium',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('issues')
      .insert([payload])
      .select()
      .single();

    if (error) {
      return handleError(error, 'Create issue');
    }

    return handleSuccess(data, 'Issue created successfully');
  } catch (error) {
    return handleError(error, 'Create issue');
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
          avatar_url
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
        ),
        assignments:issue_assignments (
          id,
          assignment_type,
          assigned_by,
          assigned_to,
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
      .order('created_at', { ascending: false });

    // Apply filters safely
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all') {
        switch (key) {
          case 'status':
          case 'category':
          case 'area':
          case 'ward':
          case 'workflowStage':
          case 'areaId':
            query = query.eq(key === 'workflowStage' ? 'workflow_stage' :
              key === 'areaId' ? 'assigned_area_id' : key, value);
            break;
          case 'assignedTo':
            query = query.eq('current_assignee_id', value);
            break;
        }
      }
    });

    const { data, error } = await query;

    if (error) {
      return handleError(error, 'Get issues');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get issues');
  }
};

export const getIssueById = async (issueId) => {
  try {
    if (!issueId) {
      return handleError({ message: 'Issue ID is required' }, 'Validation');
    }

    const { data, error } = await supabase
      .from('issues')
      .select(`
        *,
        profiles:user_id (
          full_name,
          first_name,
          user_type,
          email,
          phone
        ),
        current_assignee:current_assignee_id (
          full_name,
          user_type,
          email
        ),
        assigned_area:assigned_area_id (
          name,
          code
        ),
        assigned_department:assigned_department_id (
          name,
          code,
          category
        ),
        assignments:issue_assignments (
          id,
          assignment_type,
          assigned_by,
          assigned_to,
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
        ),
        updates:issue_updates (
          id,
          old_status,
          new_status,
          update_type,
          notes,
          created_at,
          updated_by_profile:updated_by (
            full_name,
            user_type
          )
        )
      `)
      .eq('id', issueId)
      .single();

    if (error) {
      return handleError(error, 'Get issue by ID');
    }

    return handleSuccess(data);
  } catch (error) {
    return handleError(error, 'Get issue by ID');
  }
};

export const updateIssue = async (issueId, updates) => {
  try {
    if (!issueId) {
      return handleError({ message: 'Issue ID is required' }, 'Validation');
    }

    // Validate updates
    if (updates.title && (updates.title.length < 5 || updates.title.length > 200)) {
      return handleError({ message: 'Title must be between 5 and 200 characters' }, 'Validation');
    }

    if (updates.description && (updates.description.length < 10 || updates.description.length > 2000)) {
      return handleError({ message: 'Description must be between 10 and 2000 characters' }, 'Validation');
    }

    const { data, error } = await supabase
      .from('issues')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', issueId)
      .select()
      .single();

    if (error) {
      return handleError(error, 'Update issue');
    }

    return handleSuccess(data, 'Issue updated successfully');
  } catch (error) {
    return handleError(error, 'Update issue');
  }
};

export const getUserIssues = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    const { data, error } = await supabase
      .from('issues')
      .select(`
        *,
        assigned_area:assigned_area_id (name),
        assigned_department:assigned_department_id (name, category)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return handleError(error, 'Get user issues');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get user issues');
  }
};

export const getIssuesWithLocation = async (filters = {}) => {
  try {
    let query = supabase
      .from('issues')
      .select('*')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);

    // Apply filters safely
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all') {
        switch (key) {
          case 'category':
          case 'area':
          case 'ward':
            query = query.eq(key, value);
            break;
          case 'dateFrom':
            query = query.gte('created_at', value);
            break;
        }
      }
    });

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return handleError(error, 'Get issues with location');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get issues with location');
  }
};

// Issue Assignment Functions
export const assignIssueToArea = async (issueId, areaId, notes = '') => {
  try {
    if (!issueId || !areaId) {
      return handleError({ message: 'Issue ID and Area ID are required' }, 'Validation');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    const { data, error } = await supabase.rpc('assign_issue_to_area', {
      issue_id_param: issueId,
      area_id_param: areaId,
      assigned_by_param: user.id,
      notes_param: notes
    });

    if (error) {
      return handleError(error, 'Assign issue to area');
    }

    if (data?.error) {
      return handleError({ message: data.error }, 'Assign issue to area');
    }

    return handleSuccess(null, 'Issue assigned to area successfully');
  } catch (error) {
    return handleError(error, 'Assign issue to area');
  }
};

export const assignIssueToDepartment = async (issueId, departmentId, notes = '') => {
  try {
    if (!issueId || !departmentId) {
      return handleError({ message: 'Issue ID and Department ID are required' }, 'Validation');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    const { data, error } = await supabase.rpc('assign_issue_to_department', {
      issue_id_param: issueId,
      department_id_param: departmentId,
      assigned_by_param: user.id,
      notes_param: notes
    });

    if (error) {
      return handleError(error, 'Assign issue to department');
    }

    if (data?.error) {
      return handleError({ message: data.error }, 'Assign issue to department');
    }

    return handleSuccess(null, 'Issue assigned to department successfully');
  } catch (error) {
    return handleError(error, 'Assign issue to department');
  }
};

// Backward compatibility
export const assignIssueToDepart = assignIssueToDepartment;

export const getIssuesByWorkflowStage = async (stage, areaId = null, departmentId = null) => {
  try {
    if (!stage) {
      return handleError({ message: 'Workflow stage is required' }, 'Validation');
    }

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

    if (error) {
      return handleError(error, 'Get issues by workflow stage');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get issues by workflow stage');
  }
};

// File upload validation
const validateFileUpload = (file, maxSize = MAX_FILE_SIZE) => {
  if (!file) {
    throw new Error('File is required');
  }

  if (file.size > maxSize) {
    throw new Error(`File size must be less than ${maxSize / 1024 / 1024}MB`);
  }

  return true;
};

// Upload functions with better error handling
export const uploadAvatar = async (imageUri, userId) => {
  try {
    if (!imageUri || !userId) {
      return handleError({ message: 'Image URI and User ID are required' }, 'Validation');
    }

    const fileExt = imageUri.split('.').pop()?.toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(fileExt)) {
      return handleError({ message: 'Invalid file format. Use JPG, PNG, or WebP' }, 'Validation');
    }

    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    // Convert URI to blob for upload
    const response = await fetch(imageUri);
    if (!response.ok) {
      throw new Error('Failed to fetch image');
    }

    const blob = await response.blob();
    validateFileUpload(blob);

    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(filePath, blob, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      return handleError(error, 'Upload avatar');
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    // Update user profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        avatar_url: publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) {
      return handleError(updateError, 'Update avatar URL');
    }

    return handleSuccess({ url: publicUrl }, 'Avatar uploaded successfully');
  } catch (error) {
    return handleError(error, 'Upload avatar');
  }
};

export const uploadIssueImages = async (imageUris, issueId) => {
  try {
    if (!imageUris || !Array.isArray(imageUris) || imageUris.length === 0) {
      return handleError({ message: 'Image URIs array is required' }, 'Validation');
    }

    if (!issueId) {
      return handleError({ message: 'Issue ID is required' }, 'Validation');
    }

    if (imageUris.length > 5) {
      return handleError({ message: 'Maximum 5 images allowed' }, 'Validation');
    }

    const uploadPromises = imageUris.map(async (uri, index) => {
      const fileExt = uri.split('.').pop()?.toLowerCase();
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(fileExt)) {
        throw new Error(`Invalid file format for image ${index + 1}. Use JPG, PNG, or WebP`);
      }

      const fileName = `${issueId}-${Date.now()}-${index}.${fileExt}`;
      const filePath = `issue-images/${fileName}`;

      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error(`Failed to fetch image ${index + 1}`);
      }

      const blob = await response.blob();
      validateFileUpload(blob);

      const { data, error } = await supabase.storage
        .from('issue-images')
        .upload(filePath, blob, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('issue-images')
        .getPublicUrl(filePath);

      return publicUrl;
    });

    const uploadedUrls = await Promise.all(uploadPromises);
    return handleSuccess(uploadedUrls, 'Images uploaded successfully');
  } catch (error) {
    return handleError(error, 'Upload issue images');
  }
};

// Rate limiting utility (client-side basic implementation)
const rateLimitMap = new Map();

const checkRateLimit = (key, maxRequests = 10, windowMs = 60000) => {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, []);
  }

  const requests = rateLimitMap.get(key).filter(timestamp => timestamp > windowStart);

  if (requests.length >= maxRequests) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }

  requests.push(now);
  rateLimitMap.set(key, requests);

  return true;
};

// Tender functions
export const createTender = async (tenderData) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    // Validate required fields
    if (!tenderData.title || !tenderData.description || !tenderData.category) {
      return handleError({ message: 'Title, description, and category are required' }, 'Validation');
    }

    if (!tenderData.estimated_amount || tenderData.estimated_amount <= 0) {
      return handleError({ message: 'Valid estimated amount is required' }, 'Validation');
    }

    if (!tenderData.deadline_date || new Date(tenderData.deadline_date) <= new Date()) {
      return handleError({ message: 'Deadline must be in the future' }, 'Validation');
    }

    // Rate limiting
    checkRateLimit(`tender_creation_${user.id}`, 5, 3600000); // 5 tenders per hour

    const payload = {
      ...tenderData,
      posted_by: user.id,
      status: 'available',
      source_issue_id: tenderData.source_issue_id || null,
      department_id: tenderData.department_id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('tenders')
      .insert([payload])
      .select()
      .single();

    if (error) {
      return handleError(error, 'Create tender');
    }

    return handleSuccess(data, 'Tender created successfully');
  } catch (error) {
    return handleError(error, 'Create tender');
  }
};

export const getTenders = async (status = 'all', contractorId = null) => {
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
        bids (
          id,
          amount,
          status,
          proposal,
          user_id,
          bidder:user_id (
            full_name,
            user_type
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    // Filter by contractor: only tenders assigned to or bid by this contractor
    if (contractorId) {
      query = query.or(`awarded_to.eq.${contractorId},bids.user_id.eq.${contractorId}`);
    }

    const { data, error } = await query;

    if (error) {
      return handleError(error, 'Get tenders');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get tenders');
  }
};

export const getTenderById = async (tenderId) => {
  try {
    if (!tenderId) {
      return handleError({ message: 'Tender ID is required' }, 'Validation');
    }

    const { data, error } = await supabase
      .from('tenders')
      .select(`
        *,
        posted_by_profile:posted_by (
          full_name,
          user_type,
          email
        ),
        awarded_to_profile:awarded_to (
          full_name,
          user_type
        ),
        bids (
          id,
          amount,
          status,
          proposal,
          documents,
          created_at,
          bidder:user_id (
            full_name,
            user_type,
            email,
            phone
          )
        ),
        assignments:tender_assignments (
          id,
          contract_amount,
          status,
          start_date,
          end_date,
          created_at,
          contractor:contractor_id (
            full_name,
            user_type
          ),
          assigned_by_profile:assigned_by (
            full_name,
            user_type
          )
        )
      `)
      .eq('id', tenderId)
      .single();

    if (error) {
      return handleError(error, 'Get tender by ID');
    }

    return handleSuccess(data);
  } catch (error) {
    return handleError(error, 'Get tender by ID');
  }
};

export const createBid = async (bidData) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    // Validate required fields
    if (!bidData.tender_id || !bidData.amount || !bidData.proposal) {
      return handleError({ message: 'Tender ID, amount, and proposal are required' }, 'Validation');
    }

    if (bidData.amount <= 0) {
      return handleError({ message: 'Bid amount must be positive' }, 'Validation');
    }

    if (bidData.proposal.length < 50) {
      return handleError({ message: 'Proposal must be at least 50 characters' }, 'Validation');
    }

    // Check if tender exists and is available
    const { data: tender } = await supabase
      .from('tenders')
      .select('status, deadline_date')
      .eq('id', bidData.tender_id)
      .single();

    if (!tender) {
      return handleError({ message: 'Tender not found' }, 'Validation');
    }

    if (tender.status !== 'available') {
      return handleError({ message: 'Tender is no longer available for bidding' }, 'Validation');
    }

    if (new Date(tender.deadline_date) <= new Date()) {
      return handleError({ message: 'Tender deadline has passed' }, 'Validation');
    }

    // Check if user already bid on this tender
    const { data: existingBid } = await supabase
      .from('bids')
      .select('id')
      .eq('tender_id', bidData.tender_id)
      .eq('user_id', user.id)
      .single();

    if (existingBid) {
      return handleError({ message: 'You have already bid on this tender' }, 'Validation');
    }

    // Rate limiting
    checkRateLimit(`bid_creation_${user.id}`, 10, 3600000); // 10 bids per hour

    const payload = {
      ...bidData,
      user_id: user.id,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('bids')
      .insert([payload])
      .select()
      .single();

    if (error) {
      return handleError(error, 'Create bid');
    }

    return handleSuccess(data, 'Bid submitted successfully');
  } catch (error) {
    return handleError(error, 'Create bid');
  }
};

export const getUserBids = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    const { data, error } = await supabase
      .from('bids')
      .select(`
        *,
        tender:tender_id (
          title,
          status,
          deadline_date,
          category,
          location
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return handleError(error, 'Get user bids');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get user bids');
  }
};

export const assignTenderToContractor = async (tenderId, contractorId, contractAmount, notes = '') => {
  try {
    if (!tenderId || !contractorId || !contractAmount) {
      return handleError({ message: 'Tender ID, contractor ID, and contract amount are required' }, 'Validation');
    }

    if (contractAmount <= 0) {
      return handleError({ message: 'Contract amount must be positive' }, 'Validation');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    // Start transaction-like operations
    const { error: tenderError } = await supabase
      .from('tenders')
      .update({
        status: 'awarded',
        awarded_to: contractorId,
        awarded_amount: contractAmount,
        awarded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenderId)
      .eq('status', 'available'); // Ensure tender is still available

    if (tenderError) {
      return handleError(tenderError, 'Assign tender - update tender');
    }

    // Create tender assignment
    const { error: assignError } = await supabase
      .from('tender_assignments')
      .insert([{
        tender_id: tenderId,
        contractor_id: contractorId,
        assigned_by: user.id,
        contract_amount: contractAmount,
        status: 'assigned',
        notes: notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]);

    if (assignError) {
      // Rollback tender status
      await supabase
        .from('tenders')
        .update({ status: 'available', awarded_to: null, awarded_amount: null, awarded_at: null })
        .eq('id', tenderId);

      return handleError(assignError, 'Assign tender - create assignment');
    }

    // Update bid statuses
    const { error: acceptBidError } = await supabase
      .from('bids')
      .update({
        status: 'accepted',
        updated_at: new Date().toISOString(),
      })
      .eq('tender_id', tenderId)
      .eq('user_id', contractorId);

    if (acceptBidError) {
      console.error('Failed to update accepted bid status:', acceptBidError);
    }

    // Reject other bids
    const { error: rejectBidsError } = await supabase
      .from('bids')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString(),
      })
      .eq('tender_id', tenderId)
      .neq('user_id', contractorId);

    if (rejectBidsError) {
      console.error('Failed to update rejected bids:', rejectBidsError);
    }

    return handleSuccess(null, 'Tender assigned to contractor successfully');
  } catch (error) {
    return handleError(error, 'Assign tender to contractor');
  }
};

// Work Progress functions
export const createWorkProgress = async (progressData) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    // Validate required fields
    if (!progressData.description || !progressData.progress_percentage) {
      return handleError({ message: 'Description and progress percentage are required' }, 'Validation');
    }

    if (progressData.progress_percentage < 0 || progressData.progress_percentage > 100) {
      return handleError({ message: 'Progress percentage must be between 0 and 100' }, 'Validation');
    }

    const payload = {
      ...progressData,
      contractor_id: user.id,
      status: 'submitted',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('work_progress')
      .insert([payload])
      .select()
      .single();

    if (error) {
      return handleError(error, 'Create work progress');
    }

    return handleSuccess(data, 'Work progress submitted successfully');
  } catch (error) {
    return handleError(error, 'Create work progress');
  }
};

export const getWorkProgress = async (assignmentId = null, issueId = null) => {
  try {
    let query = supabase
      .from('work_progress')
      .select(`
        *,
        contractor:contractor_id (
          full_name,
          user_type
        ),
        approved_by_profile:approved_by (
          full_name,
          user_type
        )
      `)
      .order('created_at', { ascending: false });

    if (assignmentId) {
      query = query.eq('assignment_id', assignmentId);
    }
    if (issueId) {
      query = query.eq('issue_id', issueId);
    }

    const { data, error } = await query;

    if (error) {
      return handleError(error, 'Get work progress');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get work progress');
  }
};

export const updateWorkProgress = async (progressId, updates) => {
  try {
    if (!progressId) {
      return handleError({ message: 'Progress ID is required' }, 'Validation');
    }

    if (updates.progress_percentage && (updates.progress_percentage < 0 || updates.progress_percentage > 100)) {
      return handleError({ message: 'Progress percentage must be between 0 and 100' }, 'Validation');
    }

    const { data, error } = await supabase
      .from('work_progress')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', progressId)
      .select()
      .single();

    if (error) {
      return handleError(error, 'Update work progress');
    }

    return handleSuccess(data, 'Work progress updated successfully');
  } catch (error) {
    return handleError(error, 'Update work progress');
  }
};

// Community functions
export const getCommunityFeed = async (filters = {}) => {
  try {
    const [issuesResult, postsResult] = await Promise.all([
      supabase
        .from('issues')
        .select(`
          id,
          title,
          description,
          category,
          priority,
          status,
          location_name,
          images,
          tags,
          upvotes,
          downvotes,
          views_count,
          comments_count,
          created_at,
          profiles:user_id (
            full_name,
            first_name,
            user_type,
            avatar_url
          )
        `)
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('community_posts')
        .select(`
          id,
          title,
          content,
          category,
          tags,
          images,
          likes_count,
          comments_count,
          shares_count,
          views_count,
          is_official,
          created_at,
          profiles:user_id (
            full_name,
            first_name,
            user_type,
            avatar_url
          )
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(20)
    ]);

    // Combine and format data
    const issues = (issuesResult.data || []).map(issue => ({
      ...issue,
      type: 'issue',
      content: issue.description,
    }));

    const posts = (postsResult.data || []).map(post => ({
      ...post,
      type: 'post',
      description: post.content,
    }));

    const combinedData = [...issues, ...posts]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 30); // Limit combined results

    return handleSuccess(combinedData);
  } catch (error) {
    return handleError(error, 'Get community feed');
  }
};

export const getPosts = async (filters = {}) => {
  try {
    let query = supabase
      .from('community_posts')
      .select(`
        *,
        profiles:user_id (
          full_name,
          first_name,
          user_type,
          avatar_url
        )
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      return handleError(error, 'Get posts');
    }

    return handleSuccess(data || []);
  } catch (error) {
    return handleError(error, 'Get posts');
  }
};

export const createPost = async (postData) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    // Validate required fields
    if (!postData.title || !postData.content) {
      return handleError({ message: 'Title and content are required' }, 'Validation');
    }

    if (postData.title.length < 5 || postData.title.length > 200) {
      return handleError({ message: 'Title must be between 5 and 200 characters' }, 'Validation');
    }

    if (postData.content.length < 10 || postData.content.length > 5000) {
      return handleError({ message: 'Content must be between 10 and 5000 characters' }, 'Validation');
    }

    // Rate limiting
    checkRateLimit(`post_creation_${user.id}`, 5, 3600000); // 5 posts per hour

    const payload = {
      ...postData,
      user_id: user.id,
      is_active: true,
      likes_count: 0,
      comments_count: 0,
      shares_count: 0,
      views_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('community_posts')
      .insert([payload])
      .select()
      .single();

    if (error) {
      return handleError(error, 'Create post');
    }

    return handleSuccess(data, 'Post created successfully');
  } catch (error) {
    return handleError(error, 'Create post');
  }
};

// Voting functions
export const voteOnIssue = async (issueId, voteType) => {
  try {
    if (!issueId || !['upvote', 'downvote'].includes(voteType)) {
      return handleError({ message: 'Valid issue ID and vote type (upvote/downvote) are required' }, 'Validation');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleError({ message: 'User not authenticated' }, 'Authentication');
    }

    // Rate limiting
    checkRateLimit(`vote_${user.id}`, 50, 3600000); // 50 votes per hour

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

        if (error) {
          return handleError(error, 'Remove vote');
        }

        return handleSuccess(null, 'Vote removed');
      } else {
        // Update vote type
        const { error } = await supabase
          .from('issue_votes')
          .update({
            vote_type: voteType,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingVote.id);

        if (error) {
          return handleError(error, 'Update vote');
        }

        return handleSuccess(null, 'Vote updated');
      }
    } else {
      // Create new vote
      const { error } = await supabase
        .from('issue_votes')
        .insert([{
          issue_id: issueId,
          user_id: user.id,
          vote_type: voteType,
          created_at: new Date().toISOString()
        }]);

      if (error) {
        return handleError(error, 'Create vote');
      }

      return handleSuccess(null, 'Vote recorded');
    }
  } catch (error) {
    return handleError(error, 'Vote on issue');
  }
};

export const getUserVote = async (issueId) => {
  try {
    if (!issueId) {
      return handleError({ message: 'Issue ID is required' }, 'Validation');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return handleSuccess(null); // Return null for unauthenticated users
    }

    const { data, error } = await supabase
      .from('issue_votes')
      .select('*')
      .eq('issue_id', issueId)
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
      return handleError(error, 'Get user vote');
    }

    return handleSuccess(data);
  } catch (error) {
    return handleError(error, 'Get user vote');
  }
};

// Dashboard functions with better error handling and performance
export const getAdminDashboardStats = async () => {
  try {
    // Use parallel queries with specific time ranges for better performance
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [issuesResult, usersResult, tendersResult, recentIssuesResult] = await Promise.all([
      supabase
        .from('issues')
        .select('id, status, created_at, resolved_at, category, priority'),

      supabase
        .from('profiles')
        .select('id, user_type, created_at')
        .neq('user_type', 'admin'),

      supabase
        .from('tenders')
        .select('id, status, created_at, estimated_amount'),

      supabase
        .from('issues')
        .select('id')
        .gte('created_at', sevenDaysAgo.toISOString())
    ]);

    const issues = issuesResult.data || [];
    const users = usersResult.data || [];
    const tenders = tendersResult.data || [];
    const recentIssues = recentIssuesResult.data || [];

    // Calculate statistics
    const resolvedIssues = issues.filter(i => i.status === 'resolved');
    const resolutionRate = issues.length > 0 ? Math.round((resolvedIssues.length / issues.length) * 100) : 0;

    // Calculate average response time more efficiently
    let averageResponseDays = 0;
    if (resolvedIssues.length > 0) {
      const totalDays = resolvedIssues.reduce((sum, issue) => {
        if (issue.resolved_at) {
          const created = new Date(issue.created_at);
          const resolved = new Date(issue.resolved_at);
          return sum + Math.ceil((resolved - created) / (1000 * 60 * 60 * 24));
        }
        return sum;
      }, 0);
      averageResponseDays = Math.round(totalDays / resolvedIssues.length);
    }

    // Category breakdown
    const categoryBreakdown = issues.reduce((acc, issue) => {
      acc[issue.category] = (acc[issue.category] || 0) + 1;
      return acc;
    }, {});

    // Priority breakdown
    const priorityBreakdown = issues.reduce((acc, issue) => {
      acc[issue.priority] = (acc[issue.priority] || 0) + 1;
      return acc;
    }, {});

    const stats = {
      total_issues: issues.length,
      pending_issues: issues.filter(i => i.status === 'pending').length,
      in_progress_issues: issues.filter(i => i.status === 'in_progress').length,
      resolved_issues: resolvedIssues.length,
      resolution_rate: resolutionRate,
      average_response_days: averageResponseDays,
      response_time: `${averageResponseDays} days`,
      active_users: users.length,
      recent_issues: recentIssues.length,
      active_tenders: tenders.filter(t => t.status === 'available').length,
      total_tender_value: tenders.reduce((sum, t) => sum + (t.estimated_amount || 0), 0),
      category_breakdown: categoryBreakdown,
      priority_breakdown: priorityBreakdown,
      monthly_trends: {
        issues_created: issues.filter(i => new Date(i.created_at) >= thirtyDaysAgo).length,
        issues_resolved: resolvedIssues.filter(i => new Date(i.resolved_at) >= thirtyDaysAgo).length,
        users_joined: users.filter(u => new Date(u.created_at) >= thirtyDaysAgo).length,
      }
    };

    return handleSuccess(stats);
  } catch (error) {
    return handleError(error, 'Get admin dashboard stats');
  }
};

export const getLeaderboard = async (period = 'month') => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        first_name,
        user_type,
        points,
        level,
        badges,
        avatar_url,
        created_at
      `)
      .gt('points', 0)
      .order('points', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Add computed fields
    const leaderboardData = (data || []).map((user, index) => ({
      ...user,
      rank: index + 1,
      total_score: user.points || 0,
      issues_reported: 0, // This would need to be calculated separately
      posts_created: 0,   // This would need to be calculated separately
    }));

    return { data: leaderboardData, error: null };
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return { data: null, error };
  }
};

// Location management functions
// Add these functions to your lib/supabase.js file

// Add these functions to your lib/supabase.js file

export const getStates = async () => {
  try {
    const { data, error } = await supabase
      .from('states')
      .select('*')
      .eq('is_active', true)
      .order('name');

    return { data, error };
  } catch (error) {
    console.error('Error fetching states:', error);
    return { data: null, error };
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
    console.error('Error fetching districts:', error);
    return { data: null, error };
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
    console.error('Error fetching areas:', error);
    return { data: null, error };
  }
};

// Area admin functions
export const getAreaSuperAdminDashboard = async () => {
  try {
    const { data, error } = await supabase.rpc('get_area_admin_dashboard', {
      admin_user_id: (await getCurrentUser()).user?.id
    });

    return { data, error };
  } catch (error) {
    console.error('Error fetching area admin dashboard:', error);
    return { data: null, error };
  }
};

export const getDepartmentAdminDashboard = async () => {
  try {
    const { data, error } = await supabase.rpc('get_department_admin_dashboard', {
      admin_user_id: (await getCurrentUser()).user?.id
    });

    return { data, error };
  } catch (error) {
    console.error('Error fetching department admin dashboard:', error);
    return { data: null, error };
  }
};

// Work progress functions
export const submitWorkCompletion = async (issueId, title, description, afterImages, beforeImages = []) => {
  try {
    const { data, error } = await supabase.rpc('submit_work_completion', {
      issue_id: issueId,
      title,
      description,
      after_images: afterImages,
      before_images: beforeImages
    });

    return { data, error };
  } catch (error) {
    console.error('Error submitting work completion:', error);
    return { data: null, error };
  }
};

export const approveWorkCompletion = async (workProgressId, reviewNotes = '') => {
  try {
    const { data, error } = await supabase.rpc('approve_work_completion', {
      work_progress_id: workProgressId,
      review_notes: reviewNotes
    });

    return { data, error };
  } catch (error) {
    console.error('Error approving work completion:', error);
    return { data: null, error };
  }
};

// Real-time subscriptions
export const subscribeToIssueUpdates = (callback) => {
  const channel = supabase
    .channel('issues')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'issues'
    }, (payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('Issue subscription callback error:', error);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Issues subscription established');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('Issues subscription error');
      }
    });

  return channel;
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

export const subscribeToNotifications = (userId, callback) => {
  if (!userId) {
    console.error('User ID required for notification subscription');
    return null;
  }

  const channel = supabase
    .channel('user_notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`
    }, (payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('Notification subscription callback error:', error);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Notifications subscription established');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('Notifications subscription error');
      }
    });

  return channel;
};

// Utility functions
export const formatDate = (dateString) => {
  try {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Invalid Date';
  }
};

export const formatDateTime = (dateString) => {
  try {
    return new Date(dateString).toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Invalid Date';
  }
};

export const formatCurrency = (amount) => {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount || 0);
  } catch {
    return '₹0';
  }
};

// Health check function
export const healthCheck = async () => {
  try {
    const { data, error } = await supabase.from('profiles').select('count').limit(1);

    if (error) {
      return handleError(error, 'Health check');
    }

    return handleSuccess({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error) {
    return handleError(error, 'Health check');
  }
};

export default supabase;