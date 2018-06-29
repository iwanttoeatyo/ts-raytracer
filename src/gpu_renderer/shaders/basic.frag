#version 300 es
precision highp float;

#define FLT_MAX 3.402823466e+38

in vec2 pos;
in vec3 eye;
in vec3 ray_direction;

out vec4 fragColor;

uniform float width;
uniform float height;

struct Ray{
    vec3 origin;
    vec3 direction;
};

const int Diffuse = 0;
const int Reflect = 1;
const int Refract = 2;

struct Material{
    int type;
    vec3 color;
    float fuzz;
    float refraction_index;
};

struct HitRecord{
    float t;
    vec3 pos;
    vec3 normal;
    Material mat;
};

struct Sphere{
    vec3 center;
    float radius;
    Material mat;
};

struct Screen{
    vec3 position;
    vec3 lower_left_corner;
    vec3 horizontal;
    vec3 vertical;
    float lens_radius;
    float x_wiggle;
    float y_wiggle;
};

uniform Screen screen;

uniform vec3 ambient_light;
uniform int sphere_count;
uniform int sample_count;
uniform int samples;
uniform int max_ray_bounce;
//uniform Sphere spheres[150];

uniform float rand_seed0;
uniform float rand_seed1;
uniform sampler2D last_frame;
uniform sampler2D sphere_texture;
uniform sampler2D mat_texture; 
uniform sampler2D mat_texture_extra; 

float random(vec3 scale, float seed){
    return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);
}

vec3 uniformlyRandomDirection(float seed) {
   float u = random(vec3(12.9898, 78.233, 151.7182), seed);
   float v = random(vec3(63.7264, 10.873, 623.6736), seed);
   float z = 1.0 - 2.0 * u;
   float r = sqrt(1.0 - z * z);
   float angle = 6.283185307179586 * v;
   return vec3(r * cos(angle), r * sin(angle), z);
}

vec3 uniformlyRandomVector(float seed){
    return uniformlyRandomDirection(seed) * sqrt(random(vec3(36.7539, 50.3658, 306.2759), seed));
}

vec2 uniformlyRandomVec2(vec3 scale, float seed, float seed2){
    float r = sqrt(random(scale.xyz,seed));
    float t = sqrt(random(scale.xyz,seed2)) * 6.283185307179586;
    vec2 result;
    result.x = r * cos(t);
    result.y = r * sin(t);
    return result;
}


vec3 cosineWeightedDirection(float seed, vec3 normal){
    float u =random(vec3(12.9898, 78.233, 151.7182), seed);
    float v = random(vec3(63.7264, 10.873, 623.6736), seed);
    float r = sqrt(u);
    float angle = 6.283185307179586 * v;
    vec3 sdir, tdir;
    if (abs(normal.x) < 0.5)
        sdir = cross(normal, vec3(1,0,0));
    else 
        sdir = cross(normal, vec3(0,1,0));
    
    tdir = cross(normal, sdir);
    return r*cos(angle)*sdir + r*sin(angle)*tdir + sqrt(1.-u)*normal;
}


vec3 ray_pointAtParameter(Ray ray, float t){
    vec3 result = ray.origin + t * ray.direction;
    return result;
}

float schlick(float cosine, float ref_idx){
    float r0 = (1.0-ref_idx) / (1.0 + ref_idx);
    r0 = r0*r0;
    return r0 + (1.0-r0) * pow((1.0 - cosine), 5.0);
}

bool sphereIntersection(const Sphere s, Ray ray, float t_min, float t_max, inout HitRecord rec){
    bool hit = false;
    vec3 to_sphere = ray.origin - s.center;
    float a = dot(ray.direction, ray.direction);
    float b = dot(to_sphere, ray.direction);
    float c = dot(to_sphere,to_sphere) - s.radius * s.radius;
    float discriminant = b * b -  a * c;
    
    if(discriminant > 0.0){
        float temp = (-b - sqrt(discriminant)) / a;
        if(temp < t_max && temp > t_min){
            hit = true;
        }
        if(!hit){
            temp = (-b + sqrt(discriminant)) / a;
            if(temp < t_max && temp > t_min){
               hit = true;
            }
        }
        if(hit){
            rec.t = temp;
            rec.pos = ray.origin + rec.t * ray.direction;
            rec.normal = (rec.pos - s.center) / s.radius;
            return true;
        }
    }
    return false;
}


bool intersectAll(Ray ray, float t_min, float t_max, inout HitRecord rec){
    bool hit_anything = false;
    float closest_so_far = t_max;
    
    //Spheres Loop
    float index_of_hit = 0.0;
    for(int i = 0; i < sphere_count; i++){
        float fi = float(i) / float(sphere_count);
        Sphere sphere;
        vec4 s = texture(sphere_texture, vec2(fi,0.0));
        sphere.center = s.xyz;
        sphere.radius = s.w;     
        if(sphereIntersection(sphere, ray, t_min, closest_so_far, rec)){
            index_of_hit = float(i) / float(sphere_count);
            hit_anything = true;
            closest_so_far = rec.t;
        }
    }
    if(hit_anything){
        rec.mat.color = texture(mat_texture, vec2(index_of_hit,0.0)).rgb;    
        vec2 mat = texture(mat_texture_extra, vec2(index_of_hit,0.0)).xy;
        int mat_type = int(mat.x);
        rec.mat.type = mat_type;
        rec.mat.fuzz = mat.y;
        rec.mat.refraction_index = mat.y;
    }
        
    return hit_anything;
}


vec3 color(inout Ray ray){
    HitRecord rec;
    Ray orig_ray = ray;
    vec3 final_color = vec3(0.0);
    vec3 color = vec3(1.0);


    for(int ray_bounce=0; ray_bounce <= max_ray_bounce; ray_bounce++){
        float rf = float(ray_bounce);
        if(intersectAll(ray, 0.001, FLT_MAX, rec )){
            ray.origin = rec.pos;
            vec3 reflected = reflect(normalize(ray.direction), rec.normal);
            vec3 rand =  uniformlyRandomDirection(rand_seed1 + rf * rand_seed0);                          
            if(rec.mat.type == Diffuse){
                ray.direction = rec.normal + rand;
                color  *=rec.mat.color;
            }else if(rec.mat.type == Reflect){     
                ray.direction = reflected + rec.mat.fuzz * rand;
    
                if(dot(ray.direction, rec.normal) > 0.0)
                    color *= rec.mat.color;
                else
                    color = vec3(0);

            }else if(rec.mat.type == Refract){
                vec3 outward_normal;
                float ni_over_nt;
                float reflect_prob;
                float cosine;
               
                if(dot(ray.direction, rec.normal) > 0.0){
                   outward_normal = -rec.normal;
                   ni_over_nt = rec.mat.refraction_index;
                   cosine = rec.mat.refraction_index * dot(ray.direction, rec.normal) / length(ray.direction);
                }else{
                   outward_normal = rec.normal;
                   ni_over_nt = 1.0 / rec.mat.refraction_index;
                   cosine = -dot(ray.direction, rec.normal) / length(ray.direction);
                }
                vec3 refracted = refract(normalize(ray.direction), outward_normal, ni_over_nt);
                if(length(refracted) > 0.0){
                   reflect_prob = schlick(cosine, rec.mat.refraction_index);
                }else{
                   ray.direction = reflected;
                   reflect_prob = 1.0;
                }
                float r = random(refracted, rand_seed0 + length(gl_FragCoord.xyz));
                if(r > reflect_prob){
                   ray.direction = refracted;
                }else
                   ray.direction = reflected;
            }
        }else{
             vec3 unit_direction = normalize(ray.direction);
             float t = 0.5 * (unit_direction.y + 1.0);
             final_color =  (1.0 - t) * vec3(1.0) +   t * ambient_light;
             break;
        }
    }
  
    return color*final_color;
}



void main()
{        
    Ray ray;
    vec3 prev_color =  texture(last_frame, vec2(pos.xy)).rgb;
//    prev_color.r = prev_color.r * prev_color.r;
//    prev_color.g = prev_color.g * prev_color.g;
//    prev_color.b = prev_color.b * prev_color.b;
    
    vec2 rd =  screen.lens_radius * (uniformlyRandomVec2(gl_FragCoord.xyz, rand_seed0, rand_seed1));
    vec3 offset =  screen.horizontal * rd.x + screen.vertical * rd.y;

    ray.origin =  eye  + offset;
    ray.direction = ray_direction - offset ;
     
    vec3 new_color = color(ray);

    int c = sample_count+1;
 
     //new_color = vec3(sqrt(new_color[0]),sqrt(new_color[1]),sqrt(new_color[2]));
     
    vec3 final_color = mix(prev_color,new_color, 1.0 / float(c));



    fragColor = vec4(final_color,1.0);

}


